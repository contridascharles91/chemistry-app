"""
PAEV — Prerequisite-Aware Epistemic Verification
Stages 5, 6, 9, 10: The Three-Factor Epistemic Confidence Model

THE PATENTABLE CORE:
  epistemic_confidence = source_score × prerequisite_score × abstraction_score

Stage 5 — PrerequisiteChainResolver:
  Given a retrieved paragraph, walk the prerequisite graph backwards.
  Compute prerequisite_score = fraction of required concepts attested in textbook.

Stage 6 — AbstractionLevelResolver:
  Given a student's complexity setting (1–10) and the retrieved paragraphs,
  select the version of each concept at the right abstraction depth.
  Compute abstraction_score = how well the selected paragraph matches
  the student's level.

Stage 9 — EpistemicClaimVerifier:
  For each claim: multiply source × prerequisite × abstraction
  → per-claim epistemic_confidence

Stage 10 — MultiDimensionalConfidenceModel:
  Aggregate per-claim epistemic confidences into an overall score.
  Produce structured output with learning path and abstraction notes.
"""

from __future__ import annotations
import re
import math
import json
import time
import logging
import requests
from dataclasses import dataclass, field
from typing import Optional
from collections import defaultdict

from paev_fingerprint import (
    EpistemicFingerprint, PrerequisiteGraph, ConceptNode,
    detect_blooms_level, BLOOMS_LEVELS
)

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
EMBEDDING_URL  = "https://openrouter.ai/api/v1/embeddings"
EMBEDDING_MODEL = "openai/text-embedding-3-small"

# ── Confidence thresholds ─────────────────────────────────────────────────────
VERIFIED_EPISTEMIC  = 0.65   # all three factors strong
PARTIAL_EPISTEMIC   = 0.35   # some factors weak
REFUSE_EPISTEMIC    = 0.20   # insufficient evidence


# ── Result data structures ────────────────────────────────────────────────────

@dataclass
class PrerequisiteChainResult:
    """Result of resolving the prerequisite chain for a concept/paragraph."""
    concept: str
    chain: list[str]                    # ordered: learn these first
    present_in_book: list[str]          # prerequisites that ARE in the index
    missing_from_book: list[str]        # prerequisites NOT in the index
    chain_completeness: float           # 0.0–1.0
    prerequisite_locations: list[dict]  # [{concept, chapter, section, page}]
    chain_depth: int


@dataclass
class AbstractionResolution:
    """Result of selecting the right abstraction level for a student."""
    concept: str
    student_complexity: int             # 1–10
    target_abstraction: int             # 1–5 (computed from complexity)
    selected_paragraph_id: str
    selected_abstraction_depth: int
    abstraction_score: float            # 0.0–1.0 (how well it matches)
    available_depths: list[int]         # what abstraction levels exist for this concept
    note: str                           # human-readable note e.g. "Simplified treatment (Ch.5). Rigorous treatment available in Ch.19"


@dataclass
class EpistemicClaimScore:
    """The three-factor epistemic score for a single claim."""
    claim_text: str

    # Factor A: Is the claim in the textbook?
    source_score: float
    source_paragraph_id: Optional[str]
    source_location: Optional[dict]     # {chapter, section, page, text, highlights}

    # Factor B: Are all prerequisites of this claim in the textbook?
    prerequisite_score: float
    prerequisite_chain: Optional[PrerequisiteChainResult]

    # Factor C: Is this at the right abstraction level for this student?
    abstraction_score: float
    abstraction_resolution: Optional[AbstractionResolution]

    # THE PATENT: the product of all three
    epistemic_confidence: float         # = source × prerequisite × abstraction

    status: str                         # VERIFIED / PARTIAL / UNSUPPORTED
    score_breakdown: dict


@dataclass
class LearningPathStep:
    """One step in a student's learning path to answer their question."""
    order: int
    concept: str
    chapter_num: int
    chapter_title: str
    section_num: str
    section_title: str
    page: int
    reason: str                         # why this must come first
    bloom_level: str


@dataclass
class PAEVResult:
    """
    The full output of the PAEV pipeline.
    Every answer is either Verified, Partially Verified, or Refused —
    with per-claim three-factor confidence and a learning path.
    """
    question: str
    answer: str
    status: str                         # VERIFIED | PARTIAL | REFUSED

    # Three-factor overall confidence
    overall_epistemic_confidence: float
    source_confidence_avg: float
    prerequisite_confidence_avg: float
    abstraction_confidence_avg: float

    # Per-claim epistemic scores
    claims: list[EpistemicClaimScore]

    # Top source locations used for generation
    top_sources: list[dict]

    # Learning path: what to study FIRST to understand the answer
    learning_path: list[LearningPathStep]

    # Abstraction notes: simplified vs. rigorous treatment info
    abstraction_notes: list[str]

    # Why was this refused (if applicable)?
    refuse_reason: Optional[str]

    # Missing prerequisites not in this textbook
    external_prerequisites: list[str]

    # Metadata
    model_used: str
    retrieval_mode: str
    processing_time_ms: int
    student_complexity: int


# ── Stage 5: Prerequisite Chain Resolver ─────────────────────────────────────

class PrerequisiteChainResolver:
    """
    Resolves the complete prerequisite chain for a concept/paragraph.
    Computes prerequisite_score = how complete the chain is in the textbook.
    """

    def resolve(
        self,
        concepts: list[str],
        graph: PrerequisiteGraph,
        index,                   # HierarchicalIndex
        fingerprints: dict[str, EpistemicFingerprint]
    ) -> PrerequisiteChainResult:
        """
        Resolve prerequisites for a list of concepts (e.g. from a claim).
        """
        # Get all unique prerequisites across all concepts
        all_prereqs = []
        for concept in concepts:
            c_key = concept.lower().strip()
            chain = graph.get_learning_path(c_key)
            all_prereqs.extend(chain)

        # Deduplicate preserving order
        seen = set()
        unique_prereqs = []
        for p in all_prereqs:
            if p not in seen:
                seen.add(p)
                unique_prereqs.append(p)

        if not unique_prereqs:
            return PrerequisiteChainResult(
                concept=", ".join(concepts),
                chain=[],
                present_in_book=[],
                missing_from_book=[],
                chain_completeness=1.0,
                prerequisite_locations=[],
                chain_depth=0
            )

        # Check which prerequisites ARE in the book (have a concept node)
        present = []
        missing = []
        locations = []

        for prereq in unique_prereqs:
            node = graph.nodes.get(prereq)
            if node and node.authoritative_paragraph_id:
                present.append(prereq)
                locations.append({
                    "concept": node.name,
                    "chapter_num": node.chapter_num,
                    "section_num": node.section_num,
                    "page": node.page,
                    "paragraph_id": node.authoritative_paragraph_id
                })
            else:
                # Try fuzzy match in nodes
                matched = self._fuzzy_find(prereq, graph.nodes)
                if matched:
                    present.append(prereq)
                    locations.append({"concept": matched.name, "chapter_num": matched.chapter_num,
                                      "section_num": matched.section_num, "page": matched.page,
                                      "paragraph_id": matched.authoritative_paragraph_id})
                else:
                    missing.append(prereq)

        completeness = len(present) / len(unique_prereqs) if unique_prereqs else 1.0

        return PrerequisiteChainResult(
            concept=", ".join(concepts),
            chain=unique_prereqs,
            present_in_book=present,
            missing_from_book=missing,
            chain_completeness=round(completeness, 4),
            prerequisite_locations=locations,
            chain_depth=len(unique_prereqs)
        )

    def _fuzzy_find(self, concept: str, nodes: dict) -> Optional[ConceptNode]:
        """Find a concept node by partial/fuzzy match."""
        concept_words = set(concept.lower().split())
        best_score = 0
        best_node = None
        for key, node in nodes.items():
            key_words = set(key.lower().split())
            # Jaccard similarity
            overlap = len(concept_words & key_words)
            union = len(concept_words | key_words)
            score = overlap / union if union > 0 else 0
            if score > 0.5 and score > best_score:
                best_score = score
                best_node = node
        return best_node


# ── Stage 6: Abstraction Level Resolver ──────────────────────────────────────

class AbstractionLevelResolver:
    """
    Detects multiple treatments of the same concept at different abstraction
    levels and selects the right one for the student.

    This resolves the "Ch.5 simplified Gibbs vs Ch.19 rigorous Gibbs" problem.
    """

    # Map complexity 1-10 to target abstraction depth 1-5
    COMPLEXITY_TO_ABSTRACTION = {
        1: 1, 2: 1, 3: 2, 4: 2, 5: 3,
        6: 3, 7: 4, 8: 4, 9: 5, 10: 5
    }

    def resolve(
        self,
        concept: str,
        student_complexity: int,
        graph: PrerequisiteGraph,
        index,
        fingerprints: dict[str, EpistemicFingerprint]
    ) -> AbstractionResolution:
        """
        Find all paragraphs that introduce this concept and select the
        best one for the student's complexity level.
        """
        target_depth = self.COMPLEXITY_TO_ABSTRACTION.get(student_complexity, 3)
        concept_key = concept.lower().strip()

        # Find all paragraphs that introduce this concept
        candidates = []
        for para in index.all_paragraphs():
            fp = fingerprints.get(para.id)
            if fp and any(c.lower() == concept_key for c in fp.introduces):
                candidates.append((para, fp))

        if not candidates:
            return AbstractionResolution(
                concept=concept,
                student_complexity=student_complexity,
                target_abstraction=target_depth,
                selected_paragraph_id="",
                selected_abstraction_depth=target_depth,
                abstraction_score=0.5,
                available_depths=[],
                note=f"No explicit introduction of '{concept}' found."
            )

        available_depths = sorted(set(fp.abstraction_depth for _, fp in candidates))

        # Find the paragraph whose abstraction depth is closest to target
        best_para, best_fp = min(
            candidates,
            key=lambda x: abs(x[1].abstraction_depth - target_depth)
        )
        best_depth = best_fp.abstraction_depth
        # Score: 1.0 = exact match, decays with distance
        depth_diff = abs(best_depth - target_depth)
        abstraction_score = max(0.2, 1.0 - (depth_diff * 0.2))

        # Build human-readable note
        note = self._build_note(concept, candidates, best_para, best_fp, target_depth, student_complexity)

        return AbstractionResolution(
            concept=concept,
            student_complexity=student_complexity,
            target_abstraction=target_depth,
            selected_paragraph_id=best_para.id,
            selected_abstraction_depth=best_depth,
            abstraction_score=round(abstraction_score, 4),
            available_depths=available_depths,
            note=note
        )

    def _build_note(self, concept, candidates, selected_para, selected_fp, target, complexity):
        if len(candidates) == 1:
            return f"Only one treatment of '{concept}' found (Ch.{selected_para.chapter_num})."

        depth_names = {1: "intuitive", 2: "introductory", 3: "standard", 4: "advanced", 5: "rigorous"}
        parts = []
        for para, fp in sorted(candidates, key=lambda x: x[0].page):
            label = depth_names.get(fp.abstraction_depth, "standard")
            parts.append(f"{label} treatment in Ch.{para.chapter_num} p.{para.page}")

        selected_label = depth_names.get(selected_fp.abstraction_depth, "standard")
        note = f"Using {selected_label} treatment (Ch.{selected_para.chapter_num} p.{selected_para.page}) for complexity {complexity}. "
        note += "Other treatments: " + "; ".join(p for p in parts if f"Ch.{selected_para.chapter_num} p.{selected_para.page}" not in p) + "."
        return note


# ── Stage 9 + 10: Three-Factor Epistemic Verifier ────────────────────────────

class EpistemicVerifier:
    """
    THE PATENT CORE.

    Computes per-claim epistemic confidence as the product of three factors:
      epistemic_confidence = source_score × prerequisite_score × abstraction_score

    Aggregates into overall verdict and generates learning path.
    """

    def __init__(self, api_key: str, model: str = "openai/gpt-4o-mini"):
        self.api_key = api_key
        self.model = model
        self._embed_cache: dict = {}
        self._prereq_resolver = PrerequisiteChainResolver()
        self._abstraction_resolver = AbstractionLevelResolver()

    # ── Embedding ─────────────────────────────────────────────────────────────

    def _embed(self, text: str) -> Optional[list[float]]:
        if text in self._embed_cache:
            return self._embed_cache[text]
        if not self.api_key:
            return None
        try:
            resp = requests.post(
                EMBEDDING_URL,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json",
                         "HTTP-Referer": "https://chunks-ai.vercel.app"},
                json={"model": EMBEDDING_MODEL, "input": [text]},
                timeout=15
            )
            if resp.status_code == 200:
                vec = resp.json()["data"][0]["embedding"]
                self._embed_cache[text] = vec
                return vec
        except Exception as e:
            logger.warning(f"Embed failed: {e}")
        return None

    def _cosine(self, a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x*x for x in a))
        nb = math.sqrt(sum(x*x for x in b))
        return max(0.0, dot / (na * nb)) if na > 0 and nb > 0 else 0.0

    def _tokenize(self, text: str) -> set[str]:
        stops = {'a','an','the','is','it','in','on','at','to','for','of','and','or','be','as','by'}
        return {w for w in re.findall(r'[a-z]+', text.lower()) if w not in stops and len(w) > 2}

    # ── Source retrieval (Factor A) ───────────────────────────────────────────

    def _compute_source_score(
        self, claim: str, index, fingerprints: dict
    ) -> tuple[float, Optional[str], Optional[dict]]:
        """
        Compute source_score for a claim: how well does the textbook support it?
        Returns (score, best_paragraph_id, source_location_dict)
        """
        query_tokens = self._tokenize(claim)
        query_vec = self._embed(claim)
        all_paras = index.all_paragraphs()

        scored = []
        for para in all_paras:
            para_tokens = self._tokenize(para.text)
            kw = len(query_tokens & para_tokens) / len(query_tokens | para_tokens) if query_tokens | para_tokens else 0
            sem = 0.0
            if query_vec and para.embedding:
                sem = self._cosine(query_vec, para.embedding)
            phrase = 0.3 if claim.lower()[:30] in para.text.lower() else 0.0

            if query_vec and para.embedding:
                score = 0.60 * sem + 0.30 * kw + 0.10 * phrase
            else:
                score = 0.70 * kw + 0.30 * phrase

            scored.append((para, score))

        if not scored:
            return 0.0, None, None

        scored.sort(key=lambda x: x[1], reverse=True)
        best_para, best_score = scored[0]

        highlights = self._find_highlights(claim, best_para.text)
        source_dict = {
            "paragraph_id": best_para.id,
            "chapter": {"num": best_para.chapter_num, "title": best_para.chapter_title},
            "section": {"num": best_para.section_num, "title": best_para.section_title},
            "page": best_para.page,
            "text": best_para.text,
            "semantic_type": best_para.semantic_type,
            "highlights": highlights
        }
        return round(best_score, 4), best_para.id, source_dict

    def _find_highlights(self, claim: str, para_text: str) -> list[dict]:
        highlights = []
        para_lower = para_text.lower()
        words = [w for w in re.findall(r'[a-zA-Z]{4,}', claim) if w.lower() not in {'that','this','with','from','have'}]
        for word in words[:6]:
            pos = para_lower.find(word.lower())
            if pos >= 0:
                highlights.append({"start": pos, "end": pos + len(word), "text": para_text[pos:pos+len(word)], "type": "keyword"})
        return highlights

    # ── Claim extraction ──────────────────────────────────────────────────────

    def _extract_claims(self, answer: str) -> list[str]:
        if "[NOT_IN_TEXTBOOK" in answer or not answer.strip():
            return []
        if not self.api_key:
            # Fallback: sentence split
            sentences = re.split(r'(?<=[.!?])\s+', answer)
            return [s.strip() for s in sentences if len(s.split()) >= 8][:5]
        try:
            resp = requests.post(
                OPENROUTER_URL,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json",
                         "HTTP-Referer": "https://chunks-ai.vercel.app"},
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content":
                        f"Extract 3-5 atomic verifiable factual claims from this answer. "
                        f"Return ONLY a JSON array of strings.\n\nANSWER:\n{answer[:1500]}"}],
                    "temperature": 0.0, "max_tokens": 400
                },
                timeout=15
            )
            if resp.status_code == 200:
                raw = resp.json()["choices"][0]["message"]["content"].strip()
                raw = re.sub(r'^```json\s*|\s*```$', '', raw)
                claims = json.loads(raw)
                if isinstance(claims, list):
                    return [str(c) for c in claims[:5]]
        except Exception as e:
            logger.warning(f"Claim extraction failed: {e}")
        sentences = re.split(r'(?<=[.!?])\s+', answer)
        return [s.strip() for s in sentences if len(s.split()) >= 8][:5]

    # ── Concept extraction from claim ─────────────────────────────────────────

    def _extract_concepts_from_claim(self, claim: str, graph: PrerequisiteGraph) -> list[str]:
        """Find which known graph concepts appear in this claim."""
        matched = []
        claim_lower = claim.lower()
        for concept_key, node in graph.nodes.items():
            if concept_key in claim_lower:
                matched.append(concept_key)
            for alias in node.aliases:
                if alias.lower() in claim_lower:
                    matched.append(concept_key)
                    break
        return list(set(matched))

    # ── Per-claim epistemic scoring (Stage 9) ─────────────────────────────────

    def score_claim(
        self,
        claim: str,
        index,
        fingerprints: dict[str, EpistemicFingerprint],
        graph: PrerequisiteGraph,
        student_complexity: int
    ) -> EpistemicClaimScore:
        """
        THE PATENT METHOD.
        Compute: epistemic_confidence = source × prerequisite × abstraction
        """

        # FACTOR A — Source score
        source_score, best_para_id, source_loc = self._compute_source_score(claim, index, fingerprints)

        # FACTOR B — Prerequisite completeness score
        concepts_in_claim = self._extract_concepts_from_claim(claim, graph)
        if concepts_in_claim:
            chain_result = self._prereq_resolver.resolve(concepts_in_claim, graph, index, fingerprints)
            prereq_score = chain_result.chain_completeness
        else:
            # No known concepts in claim — give partial credit (not zero, not full)
            chain_result = None
            prereq_score = 0.7  # neutral: can't verify prerequisites

        # FACTOR C — Abstraction match score
        if concepts_in_claim:
            abstraction_results = [
                self._abstraction_resolver.resolve(c, student_complexity, graph, index, fingerprints)
                for c in concepts_in_claim[:3]  # top 3 concepts
            ]
            abstraction_score = sum(r.abstraction_score for r in abstraction_results) / len(abstraction_results)
            best_abstraction = abstraction_results[0] if abstraction_results else None
        else:
            abstraction_score = 0.8   # neutral: no concept to resolve
            best_abstraction = None

        # THE PRODUCT — epistemic confidence
        epistemic_conf = source_score * prereq_score * abstraction_score

        # Status
        if epistemic_conf >= VERIFIED_EPISTEMIC:
            status = "VERIFIED"
        elif epistemic_conf >= PARTIAL_EPISTEMIC:
            status = "PARTIAL"
        else:
            status = "UNSUPPORTED"

        return EpistemicClaimScore(
            claim_text=claim,
            source_score=round(source_score, 4),
            source_paragraph_id=best_para_id,
            source_location=source_loc,
            prerequisite_score=round(prereq_score, 4),
            prerequisite_chain=chain_result,
            abstraction_score=round(abstraction_score, 4),
            abstraction_resolution=best_abstraction,
            epistemic_confidence=round(epistemic_conf, 4),
            status=status,
            score_breakdown={
                "source":       round(source_score,      4),
                "prerequisite": round(prereq_score,      4),
                "abstraction":  round(abstraction_score, 4),
                "epistemic":    round(epistemic_conf,    4),
            }
        )

    # ── Learning path generator ───────────────────────────────────────────────

    def _build_learning_path(
        self,
        claims: list[EpistemicClaimScore],
        graph: PrerequisiteGraph,
        index
    ) -> list[LearningPathStep]:
        """
        Collect all prerequisites from all claim chains and build an ordered
        reading path: what the student should study first.
        """
        all_prereqs = {}   # concept → location info

        for claim_score in claims:
            if claim_score.prerequisite_chain:
                for loc in claim_score.prerequisite_chain.prerequisite_locations:
                    key = loc["concept"].lower()
                    if key not in all_prereqs:
                        all_prereqs[key] = loc

        if not all_prereqs:
            return []

        steps = []
        for i, (concept_key, loc) in enumerate(all_prereqs.items(), start=1):
            node = graph.nodes.get(concept_key)
            bloom = node.bloom_level_introduced if node else "understand"

            # Find chapter/section titles from the index
            ch_num = loc.get("chapter_num", 1)
            sec_num = loc.get("section_num", "1.0")
            ch_title = ""
            sec_title = ""
            ch_obj = index.chapters.get(ch_num)
            if ch_obj:
                ch_title = ch_obj.title
                sec_obj = ch_obj.sections.get(sec_num)
                if sec_obj:
                    sec_title = sec_obj.title

            steps.append(LearningPathStep(
                order=i,
                concept=loc["concept"],
                chapter_num=ch_num,
                chapter_title=ch_title,
                section_num=sec_num,
                section_title=sec_title,
                page=loc.get("page", 0),
                reason=f"Required before understanding the answer",
                bloom_level=bloom
            ))

        return steps[:8]   # cap at 8 steps

    # ── Answer generation ─────────────────────────────────────────────────────

    def generate_answer(
        self,
        question: str,
        retrieved_paras: list,
        book_title: str,
        student_complexity: int,
        history: Optional[list] = None
    ) -> str:
        complexity_desc = {
            1:"very simple",2:"beginner",3:"high school",4:"pre-university",
            5:"first-year university",6:"second-year university",7:"advanced undergraduate",
            8:"senior undergraduate",9:"graduate",10:"expert/research"
        }.get(student_complexity, "university")

        context = "\n\n".join([
            f"[SOURCE {i} | Ch.{p.chapter_num} §{p.section_num} p.{p.page} | {p.semantic_type}]\n{p.text}"
            for i, p in enumerate(retrieved_paras[:6], 1)
        ])

        system = (
            f"You are an expert tutor for '{book_title}'. "
            f"RULES: Answer ONLY from the SOURCE blocks. "
            f"If the answer is not in the sources, respond: [NOT_IN_TEXTBOOK: reason]. "
            f"Cite every claim with (Ch.N §X.Y p.Z). "
            f"LaTeX: inline $...$ display $$...$$. "
            f"Level: {complexity_desc}."
        )
        messages = [{"role": "system", "content": system}]
        if history:
            for h in (history or [])[-4:]:
                if h.get("role") in ("user", "assistant"):
                    messages.append(h)
        messages.append({"role": "user", "content":
            f"SOURCES:\n{context}\n\nQUESTION: {question}\n\nAnswer from the sources:"})

        try:
            resp = requests.post(
                OPENROUTER_URL,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json",
                         "HTTP-Referer": "https://chunks-ai.vercel.app"},
                json={"model": self.model, "messages": messages, "temperature": 0.05, "max_tokens": 3000},
                timeout=55
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
            return f"[ERROR {resp.status_code}]"
        except Exception as e:
            return f"[ERROR: {e}]"

    # ── Retrieval (adapted from VAKS) ─────────────────────────────────────────

    def retrieve(self, query: str, index, fingerprints: dict, top_k: int = 8) -> list:
        query_tokens = self._tokenize(query)
        query_vec = self._embed(query)
        scored = []
        for para in index.all_paragraphs():
            para_tokens = self._tokenize(para.text)
            kw = len(query_tokens & para_tokens) / len(query_tokens | para_tokens) if query_tokens | para_tokens else 0
            sem = 0.0
            if query_vec and para.embedding:
                sem = self._cosine(query_vec, para.embedding)
            phrase = 0.3 if query.lower()[:25] in para.text.lower() else 0.0

            fp = fingerprints.get(para.id)
            type_boost = 0.0
            if fp:
                q_lower = query.lower()
                if re.search(r'\bwhat is\b|\bdefine\b', q_lower) and fp.is_authoritative_definition:
                    type_boost = 0.05
                if re.search(r'\bhow\b|\bcalculate\b', q_lower) and para.semantic_type in ("equation","procedure"):
                    type_boost = 0.05

            if query_vec and para.embedding:
                final = 0.55 * sem + 0.30 * kw + 0.10 * phrase + type_boost
            else:
                final = 0.65 * kw + 0.25 * phrase + type_boost

            scored.append((para, final))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [p for p, _ in scored[:top_k]]

    # ── Full PAEV pipeline ────────────────────────────────────────────────────

    def run(
        self,
        question: str,
        index,
        fingerprints: dict[str, EpistemicFingerprint],
        graph: PrerequisiteGraph,
        student_complexity: int = 5,
        history: Optional[list] = None
    ) -> PAEVResult:
        """
        Full 10-stage PAEV pipeline.
        Returns a PAEVResult with three-factor epistemic confidence.
        """
        t_start = time.time()

        # Stage 4: Retrieve
        retrieved = self.retrieve(question, index, fingerprints, top_k=8)
        retrieval_mode = "hybrid" if (retrieved and retrieved[0].embedding) else "keyword"

        top_sources = [
            {
                "chapter": {"num": p.chapter_num, "title": p.chapter_title},
                "section": {"num": p.section_num, "title": p.section_title},
                "page": p.page,
                "text": p.text[:200],
                "semantic_type": p.semantic_type
            }
            for p in retrieved[:3]
        ]

        # Early refuse: weak retrieval
        if not retrieved:
            ms = int((time.time() - t_start) * 1000)
            return self._refused("No relevant paragraphs retrieved from textbook.", question, top_sources, retrieval_mode, ms, student_complexity)

        # Stage 7: Generate answer
        answer = self.generate_answer(question, retrieved, index.book_title, student_complexity, history)

        if "[NOT_IN_TEXTBOOK" in answer:
            ms = int((time.time() - t_start) * 1000)
            return self._refused("The AI model determined this topic is not covered in the textbook.", question, top_sources, retrieval_mode, ms, student_complexity)

        # Stage 8: Extract claims
        claim_texts = self._extract_claims(answer)
        if not claim_texts:
            claim_texts = [question]

        # Stage 9: Score each claim (source × prerequisite × abstraction)
        scored_claims: list[EpistemicClaimScore] = []
        for claim in claim_texts:
            scored = self.score_claim(claim, index, fingerprints, graph, student_complexity)
            scored_claims.append(scored)

        # Stage 10: Aggregate multi-dimensional confidence
        src_avg  = sum(c.source_score        for c in scored_claims) / len(scored_claims)
        pre_avg  = sum(c.prerequisite_score  for c in scored_claims) / len(scored_claims)
        abs_avg  = sum(c.abstraction_score   for c in scored_claims) / len(scored_claims)
        ep_avg   = sum(c.epistemic_confidence for c in scored_claims) / len(scored_claims)

        # Status
        verified_count = sum(1 for c in scored_claims if c.status == "VERIFIED")
        if ep_avg >= VERIFIED_EPISTEMIC and verified_count >= max(1, len(scored_claims) // 2):
            status = "VERIFIED"
        elif ep_avg >= PARTIAL_EPISTEMIC:
            status = "PARTIAL"
        else:
            status = "REFUSED"

        # Build learning path from prerequisite chains
        learning_path = self._build_learning_path(scored_claims, graph, index)

        # Collect abstraction notes
        abstraction_notes = []
        for cs in scored_claims:
            if cs.abstraction_resolution and cs.abstraction_resolution.note:
                note = cs.abstraction_resolution.note
                if note not in abstraction_notes:
                    abstraction_notes.append(note)

        # Collect external prerequisites (not in book)
        external_prereqs = []
        for cs in scored_claims:
            if cs.prerequisite_chain:
                external_prereqs.extend(cs.prerequisite_chain.missing_from_book)
        external_prereqs = list(set(external_prereqs))

        ms = int((time.time() - t_start) * 1000)
        logger.info(f"PAEV [{status}] ep={ep_avg:.3f} src={src_avg:.3f} pre={pre_avg:.3f} abs={abs_avg:.3f} | {ms}ms")

        refuse_reason = None
        if status == "REFUSED":
            refuse_reason = (
                f"Epistemic confidence {ep_avg:.0%} is below the {REFUSE_EPISTEMIC:.0%} threshold. "
                f"Source evidence: {src_avg:.0%}, Prerequisite chain: {pre_avg:.0%}, "
                f"Abstraction match: {abs_avg:.0%}."
            )

        return PAEVResult(
            question=question,
            answer=answer,
            status=status,
            overall_epistemic_confidence=round(ep_avg, 4),
            source_confidence_avg=round(src_avg, 4),
            prerequisite_confidence_avg=round(pre_avg, 4),
            abstraction_confidence_avg=round(abs_avg, 4),
            claims=scored_claims,
            top_sources=top_sources,
            learning_path=learning_path,
            abstraction_notes=abstraction_notes,
            refuse_reason=refuse_reason,
            external_prerequisites=external_prereqs,
            model_used=self.model,
            retrieval_mode=retrieval_mode,
            processing_time_ms=ms,
            student_complexity=student_complexity
        )

    def _refused(self, reason, question, sources, mode, ms, complexity) -> PAEVResult:
        return PAEVResult(
            question=question, answer="", status="REFUSED",
            overall_epistemic_confidence=0.0,
            source_confidence_avg=0.0, prerequisite_confidence_avg=0.0, abstraction_confidence_avg=0.0,
            claims=[], top_sources=sources, learning_path=[], abstraction_notes=[],
            refuse_reason=reason, external_prerequisites=[],
            model_used=self.model, retrieval_mode=mode,
            processing_time_ms=ms, student_complexity=complexity
        )

    # ── Serialization ─────────────────────────────────────────────────────────

    @staticmethod
    def result_to_dict(result: PAEVResult) -> dict:
        def chain_to_dict(c):
            if not c:
                return None
            return {
                "concept": c.concept, "chain": c.chain,
                "present_in_book": c.present_in_book,
                "missing_from_book": c.missing_from_book,
                "chain_completeness": c.chain_completeness,
                "prerequisite_locations": c.prerequisite_locations,
                "chain_depth": c.chain_depth
            }
        def abstraction_to_dict(a):
            if not a:
                return None
            return {
                "concept": a.concept,
                "target_abstraction": a.target_abstraction,
                "selected_abstraction_depth": a.selected_abstraction_depth,
                "abstraction_score": a.abstraction_score,
                "available_depths": a.available_depths,
                "note": a.note
            }

        claims_out = []
        for c in result.claims:
            claims_out.append({
                "claim": c.claim_text,
                "status": c.status,
                "epistemic_confidence": c.epistemic_confidence,
                "score_breakdown": c.score_breakdown,
                "source": c.source_location,
                "prerequisite_chain": chain_to_dict(c.prerequisite_chain),
                "abstraction": abstraction_to_dict(c.abstraction_resolution),
            })

        path_out = []
        for step in result.learning_path:
            path_out.append({
                "order": step.order, "concept": step.concept,
                "chapter_num": step.chapter_num, "chapter_title": step.chapter_title,
                "section_num": step.section_num, "section_title": step.section_title,
                "page": step.page, "reason": step.reason, "bloom_level": step.bloom_level
            })

        return {
            "question": result.question,
            "answer": result.answer,
            "status": result.status,
            "confidence": {
                "overall_epistemic":   result.overall_epistemic_confidence,
                "source_avg":          result.source_confidence_avg,
                "prerequisite_avg":    result.prerequisite_confidence_avg,
                "abstraction_avg":     result.abstraction_confidence_avg,
            },
            "claims": claims_out,
            "top_sources": result.top_sources,
            "learning_path": path_out,
            "abstraction_notes": result.abstraction_notes,
            "external_prerequisites": result.external_prerequisites,
            "refuse_reason": result.refuse_reason,
            "model_used": result.model_used,
            "retrieval_mode": result.retrieval_mode,
            "processing_time_ms": result.processing_time_ms,
            "student_complexity": result.student_complexity,
        }
