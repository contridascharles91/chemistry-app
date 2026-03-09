"""
PAEV — Prerequisite-Aware Epistemic Verification
Stage 2 + 3: Concept Dependency Extractor + Epistemic Fingerprint Builder

THE CORE NOVEL INVENTION:
  Every paragraph in the textbook gets an "Epistemic Fingerprint" —
  a structured record of what concepts it introduces, what concepts it
  requires (prerequisites), what Bloom's level it operates at, and
  what abstraction depth it represents.

  This data structure is the foundation of the three-factor confidence:
    epistemic_confidence = source_score × prerequisite_score × abstraction_score

Data structures:
  EpistemicFingerprint  — attached to every paragraph
  PrerequisiteGraph     — directed graph of concept dependencies across the book
  ConceptNode           — a named concept with its canonical definition location
"""

from __future__ import annotations
import re
import json
import time
import logging
import requests
from dataclasses import dataclass, field, asdict
from typing import Optional
from collections import defaultdict

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# ── Bloom's Taxonomy levels ───────────────────────────────────────────────────
BLOOMS_LEVELS = {
    1: "remember",    # recall facts, basic concepts
    2: "understand",  # explain ideas or concepts
    3: "apply",       # use information in new situations
    4: "analyze",     # draw connections, break down information
    5: "evaluate",    # justify a decision or course of action
    6: "create",      # produce new or original work
}

BLOOMS_KEYWORDS = {
    "remember":   r'\b(define|list|recall|identify|name|state|what is|who|when|where)\b',
    "understand": r'\b(explain|describe|summarize|interpret|classify|compare|what does)\b',
    "apply":      r'\b(calculate|solve|use|apply|demonstrate|compute|find the|determine)\b',
    "analyze":    r'\b(analyze|distinguish|examine|differentiate|relate|why does|how does)\b',
    "evaluate":   r'\b(evaluate|justify|critique|assess|argue|support|conclude)\b',
    "create":     r'\b(design|construct|develop|formulate|propose|predict|derive)\b',
}

def detect_blooms_level(text: str) -> str:
    text_lower = text.lower()
    scores = {}
    for level, pattern in BLOOMS_KEYWORDS.items():
        matches = len(re.findall(pattern, text_lower))
        if matches:
            scores[level] = matches
    if not scores:
        return "understand"
    return max(scores, key=scores.get)

def detect_abstraction_depth(text: str) -> int:
    """
    1 = highly simplified/conceptual (no math, intuitive language)
    2 = introductory (basic formulas, definitions)
    3 = standard undergraduate (full treatment)
    4 = advanced undergraduate (derivations, edge cases)
    5 = rigorous/graduate (full mathematical treatment)
    """
    # Heuristics based on mathematical density and qualifier language
    math_density = len(re.findall(r'[=\+\-\*\/\^∑∫∂∇≈±]|\\frac|\\sum|\\int', text)) / max(len(text.split()), 1)
    has_derivation = bool(re.search(r'\b(derive|derivation|proof|rigorously|formally|it can be shown)\b', text, re.I))
    has_simplification = bool(re.search(r'\b(simplified|approximat|assume|ideally|in practice|roughly|about)\b', text, re.I))
    has_advanced = bool(re.search(r'\b(quantum|relativistic|perturbation|eigenvalue|lagrangian|hamiltonian)\b', text, re.I))
    equation_count = len(re.findall(r'\$\$|\$[^$]+\$|[A-Z]_\{', text))

    score = 2  # default: introductory
    if math_density > 0.05 or equation_count > 2:
        score += 1
    if has_derivation:
        score += 1
    if has_advanced:
        score += 1
    if has_simplification:
        score -= 1
    return max(1, min(5, score))


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class EpistemicFingerprint:
    """
    The core novel data structure. Attached to every paragraph in the index.
    Encodes what this paragraph knows, needs, and teaches.
    """
    paragraph_id: str

    # What concepts does this paragraph introduce or define?
    introduces: list[str] = field(default_factory=list)

    # What concepts must the student already know to understand this?
    requires: list[str] = field(default_factory=list)

    # What concepts from earlier in the book does this refine or extend?
    refines: list[str] = field(default_factory=list)

    # Bloom's taxonomy level of this paragraph
    bloom_level: str = "understand"    # remember/understand/apply/analyze/evaluate/create
    bloom_depth:  int = 2              # 1–6 numeric

    # How abstract/rigorous is this treatment? 1=simplified, 5=rigorous
    abstraction_depth: int = 2

    # Is this the authoritative/canonical definition of a concept?
    is_authoritative_definition: bool = False

    # Does a later paragraph supersede this one with a more rigorous treatment?
    superseded_by_id:  Optional[str] = None

    # Does this paragraph supersede an earlier simplified treatment?
    supersedes_id:     Optional[str] = None

    # Extraction confidence (how confident the LLM was in extracting this)
    extraction_confidence: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> 'EpistemicFingerprint':
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class ConceptNode:
    """A named concept in the prerequisite graph."""
    name: str                          # canonical name e.g. "Gibbs Free Energy"
    aliases: list[str]                 # alternative names
    authoritative_paragraph_id: str    # where it's best defined
    page: int
    chapter_num: int
    section_num: str
    bloom_level_introduced: str
    abstraction_depth_introduced: int
    dependent_concepts: list[str] = field(default_factory=list)   # concepts that NEED this
    prerequisite_concepts: list[str] = field(default_factory=list) # concepts this NEEDS


@dataclass
class PrerequisiteGraph:
    """
    The directed prerequisite dependency graph for the entire book.
    Nodes = concepts. Edges = "requires" relationships.
    """
    book_id: str
    book_title: str
    nodes: dict[str, ConceptNode] = field(default_factory=dict)    # concept_name → node
    # edges[A] = [B, C] means "concept A requires concepts B and C"
    edges: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    # reverse: reverse_edges[B] = [A, D] means "B is required by A and D"
    reverse_edges: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))

    def add_dependency(self, concept: str, requires: str):
        """Add: concept requires prerequisite."""
        if requires not in self.edges[concept]:
            self.edges[concept].append(requires)
        if concept not in self.reverse_edges[requires]:
            self.reverse_edges[requires].append(concept)

    def get_all_prerequisites(self, concept: str, visited: set = None) -> list[str]:
        """
        Recursively get ALL prerequisites (transitive closure).
        Returns flat list of all concepts needed before this one.
        """
        if visited is None:
            visited = set()
        if concept in visited:
            return []
        visited.add(concept)
        direct = self.edges.get(concept, [])
        all_prereqs = list(direct)
        for prereq in direct:
            all_prereqs.extend(self.get_all_prerequisites(prereq, visited))
        return list(dict.fromkeys(all_prereqs))  # deduplicated, order-preserving

    def get_learning_path(self, concept: str) -> list[str]:
        """
        Return the ordered list of concepts to learn BEFORE this concept.
        Topologically sorted: root concepts first.
        """
        all_prereqs = self.get_all_prerequisites(concept)
        # Simple topological sort by how many prerequisites each has
        def prereq_count(c):
            return len(self.get_all_prerequisites(c))
        return sorted(all_prereqs, key=prereq_count)

    def to_dict(self) -> dict:
        return {
            "book_id": self.book_id,
            "book_title": self.book_title,
            "nodes": {k: asdict(v) for k, v in self.nodes.items()},
            "edges": dict(self.edges),
            "reverse_edges": dict(self.reverse_edges),
        }

    @classmethod
    def from_dict(cls, d: dict) -> 'PrerequisiteGraph':
        g = cls(book_id=d["book_id"], book_title=d["book_title"])
        for name, node_data in d.get("nodes", {}).items():
            g.nodes[name] = ConceptNode(**node_data)
        g.edges = defaultdict(list, d.get("edges", {}))
        g.reverse_edges = defaultdict(list, d.get("reverse_edges", {}))
        return g


# ── LLM-based fingerprint extractor ──────────────────────────────────────────

class EpistemicFingerprintBuilder:
    """
    Uses an LLM to extract the epistemic fingerprint of each paragraph.
    Batches paragraphs together for efficiency.
    """

    EXTRACTION_SYSTEM = """You are an expert educational content analyzer.
Your job is to analyze a textbook paragraph and extract its epistemic structure.
You MUST respond with ONLY valid JSON — no other text, no markdown, no explanation.

For each paragraph, extract:
- introduces: list of concepts/terms this paragraph defines or introduces for the first time
- requires: list of concepts the student must already know to understand this paragraph
- refines: list of concepts from earlier chapters that this paragraph extends or makes more rigorous
- is_authoritative_definition: true only if this is the primary, formal definition of a concept
- confidence: float 0.0-1.0 representing how confident you are in this extraction

Keep concept names SHORT and CANONICAL (e.g. "Gibbs free energy" not "the change in Gibbs free energy at constant temperature and pressure").
Maximum 5 items per list."""

    def __init__(self, api_key: str, model: str = "openai/gpt-4o-mini"):
        self.api_key = api_key
        self.model = model

    def _call_llm(self, prompt: str, max_tokens: int = 800) -> Optional[str]:
        try:
            resp = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://chunks-ai.vercel.app",
                    "X-Title": "PAEV Fingerprint Builder"
                },
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": self.EXTRACTION_SYSTEM},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.0,
                    "max_tokens": max_tokens
                },
                timeout=30
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
            logger.warning(f"LLM call failed {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"LLM call error: {e}")
        return None

    def extract_fingerprint(
        self,
        paragraph_id: str,
        text: str,
        chapter_title: str,
        section_title: str
    ) -> EpistemicFingerprint:
        """Extract the epistemic fingerprint of a single paragraph."""

        # Heuristic-only extraction (fast, no API cost)
        bloom = detect_blooms_level(text)
        bloom_depth = list(BLOOMS_LEVELS.values()).index(bloom) + 1
        abstraction = detect_abstraction_depth(text)
        is_auth_def = bool(re.search(
            r'\b(is defined as|is the|refers to|we define|definition of)\b', text, re.I
        ))

        fp = EpistemicFingerprint(
            paragraph_id=paragraph_id,
            bloom_level=bloom,
            bloom_depth=bloom_depth,
            abstraction_depth=abstraction,
            is_authoritative_definition=is_auth_def,
            extraction_confidence=0.5  # heuristic only
        )

        # LLM extraction for introduces/requires/refines
        if not self.api_key:
            return fp

        prompt = f"""Chapter: {chapter_title}
Section: {section_title}

PARAGRAPH:
{text[:800]}

Respond with ONLY this JSON (fill in the lists):
{{
  "introduces": [],
  "requires": [],
  "refines": [],
  "is_authoritative_definition": false,
  "confidence": 0.8
}}"""

        raw = self._call_llm(prompt)
        if raw:
            try:
                raw = re.sub(r'^```json\s*', '', raw.strip())
                raw = re.sub(r'\s*```$', '', raw)
                data = json.loads(raw)
                fp.introduces = [str(c).strip() for c in data.get("introduces", [])[:5]]
                fp.requires   = [str(c).strip() for c in data.get("requires",   [])[:5]]
                fp.refines    = [str(c).strip() for c in data.get("refines",    [])[:5]]
                fp.is_authoritative_definition = bool(data.get("is_authoritative_definition", is_auth_def))
                fp.extraction_confidence = float(data.get("confidence", 0.8))
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                logger.warning(f"Fingerprint parse error for {paragraph_id}: {e}")

        return fp

    def build_fingerprints_for_index(
        self,
        index,           # HierarchicalIndex
        sample_rate: float = 1.0,   # 1.0 = all paragraphs, 0.1 = 10% sample
        delay_s: float = 0.15       # rate limit buffer
    ) -> dict[str, EpistemicFingerprint]:
        """
        Build fingerprints for all paragraphs in an index.
        Returns: dict[paragraph_id → EpistemicFingerprint]
        """
        all_paras = index.all_paragraphs()
        total = len(all_paras)
        logger.info(f"Building epistemic fingerprints for {total} paragraphs (sample={sample_rate:.0%})")

        fingerprints: dict[str, EpistemicFingerprint] = {}
        processed = 0

        for i, para in enumerate(all_paras):
            # Sample rate: skip some paragraphs for speed
            if sample_rate < 1.0 and (i % int(1 / sample_rate)) != 0:
                continue

            fp = self.extract_fingerprint(
                paragraph_id=para.id,
                text=para.text,
                chapter_title=para.chapter_title,
                section_title=para.section_title
            )
            fingerprints[para.id] = fp
            processed += 1

            if processed % 20 == 0:
                logger.info(f"  Fingerprinted {processed} paragraphs...")
            if self.api_key and delay_s > 0:
                time.sleep(delay_s)

        logger.info(f"✅ Fingerprints built: {len(fingerprints)}")
        return fingerprints

    def build_prerequisite_graph(
        self,
        index,                              # HierarchicalIndex
        fingerprints: dict[str, EpistemicFingerprint]
    ) -> PrerequisiteGraph:
        """
        Build the prerequisite graph from the fingerprint data.
        Each "introduces" entry becomes a ConceptNode.
        Each "requires" entry adds an edge.
        """
        graph = PrerequisiteGraph(book_id=index.book_id, book_title=index.book_title)

        # Pass 1: Build concept nodes from "introduces"
        for para in index.all_paragraphs():
            fp = fingerprints.get(para.id)
            if not fp:
                continue
            for concept in fp.introduces:
                c_key = concept.lower().strip()
                if c_key not in graph.nodes:
                    graph.nodes[c_key] = ConceptNode(
                        name=concept,
                        aliases=[],
                        authoritative_paragraph_id=para.id if fp.is_authoritative_definition else "",
                        page=para.page,
                        chapter_num=para.chapter_num,
                        section_num=para.section_num,
                        bloom_level_introduced=fp.bloom_level,
                        abstraction_depth_introduced=fp.abstraction_depth,
                    )
                elif fp.is_authoritative_definition:
                    # Update to the authoritative definition location
                    graph.nodes[c_key].authoritative_paragraph_id = para.id
                    graph.nodes[c_key].page = para.page

        # Pass 2: Build dependency edges from "requires"
        for para in index.all_paragraphs():
            fp = fingerprints.get(para.id)
            if not fp:
                continue
            for introduced_concept in fp.introduces:
                for required_concept in fp.requires:
                    graph.add_dependency(
                        concept=introduced_concept.lower().strip(),
                        requires=required_concept.lower().strip()
                    )

        # Pass 3: Populate dependent_concepts on each node
        for concept, prereqs in graph.edges.items():
            if concept in graph.nodes:
                graph.nodes[concept].prerequisite_concepts = prereqs
        for concept, dependents in graph.reverse_edges.items():
            if concept in graph.nodes:
                graph.nodes[concept].dependent_concepts = dependents

        logger.info(
            f"✅ Prerequisite graph: {len(graph.nodes)} concepts, "
            f"{sum(len(v) for v in graph.edges.values())} dependency edges"
        )
        return graph

    def detect_abstraction_supersessions(
        self,
        index,
        fingerprints: dict[str, EpistemicFingerprint]
    ) -> dict[str, EpistemicFingerprint]:
        """
        Detect when two paragraphs introduce the SAME concept at different
        abstraction depths. The lower-abstraction one gets superseded_by_id
        pointing to the higher-abstraction one.
        """
        # Group paragraphs by concept introduced
        concept_to_paras: dict[str, list] = defaultdict(list)
        for para in index.all_paragraphs():
            fp = fingerprints.get(para.id)
            if not fp:
                continue
            for concept in fp.introduces:
                concept_to_paras[concept.lower()].append((para, fp))

        supersession_count = 0
        for concept, para_fps in concept_to_paras.items():
            if len(para_fps) < 2:
                continue
            # Sort by page number (earlier = simplified, later = more rigorous)
            sorted_by_page = sorted(para_fps, key=lambda x: x[0].page)
            for i in range(len(sorted_by_page) - 1):
                para_early, fp_early = sorted_by_page[i]
                para_late,  fp_late  = sorted_by_page[i + 1]
                # If later treatment is more rigorous
                if fp_late.abstraction_depth > fp_early.abstraction_depth:
                    fingerprints[fp_early.paragraph_id].superseded_by_id = para_late.id
                    fingerprints[fp_late.paragraph_id].supersedes_id = para_early.id
                    supersession_count += 1

        logger.info(f"✅ Supersession pairs detected: {supersession_count}")
        return fingerprints
