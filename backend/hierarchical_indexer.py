"""
VAKS — Verified AI Knowledge System
Stage 1: Hierarchical Textbook Indexer

Converts a PDF textbook into a structured index:
  Chapter → Section → Page → Paragraph

Each paragraph gets:
  - Unique ID
  - Structural address (ch, section, page, position)
  - Semantic type (definition, theorem, example, equation, explanation)
  - Keywords
  - Embedding vector (via OpenRouter)
  - Character offsets for precise highlighting

Output: JSON index file ready for Stage 2 retrieval
"""

import re
import json
import math
import time
import logging
import hashlib
import os
from collections import defaultdict, Counter
from dataclasses import dataclass, field, asdict
from typing import Optional
import requests

logger = logging.getLogger(__name__)

# ── Semantic type detector ────────────────────────────────────────────────────
_SEMANTIC_PATTERNS = {
    "definition": re.compile(
        r'\b(is defined as|is the|refers to|means that|definition of|'
        r'can be defined|is known as|called a|is a type of)\b', re.I
    ),
    "equation": re.compile(
        r'(=\s*[\w\(\)\[\]\/\+\-\*\^]+|\\frac|\\sum|\\int|∑|∫|'
        r'ΔG|ΔH|ΔS|Ka|Kb|Ksp|Keq|pH\s*=|pKa|mol/L)', re.I
    ),
    "example": re.compile(
        r'\b(for example|for instance|consider|as an illustration|'
        r'such as|e\.g\.|i\.e\.|sample problem|worked example|try this)\b', re.I
    ),
    "theorem": re.compile(
        r'\b(law of|principle of|theorem|postulate|according to|'
        r'states that|first law|second law|hess\'s law|le chatelier)\b', re.I
    ),
    "procedure": re.compile(
        r'\b(step \d|procedure|method|protocol|first,|then,|next,|'
        r'finally,|to calculate|to determine|how to)\b', re.I
    ),
}

def detect_semantic_type(text: str) -> str:
    scores = {}
    for stype, pattern in _SEMANTIC_PATTERNS.items():
        matches = len(pattern.findall(text))
        if matches:
            scores[stype] = matches
    return max(scores, key=scores.get) if scores else "explanation"

# ── Chapter/Section boundary detectors ───────────────────────────────────────
_CHAPTER_RE = re.compile(
    r'^(?:CHAPTER|Chapter)\s+(\d+)\s*[:\-–—]?\s*(.{3,80})$',
    re.MULTILINE
)
_SECTION_RE = re.compile(
    r'^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+([A-Z][^\n]{2,80})$',
    re.MULTILINE
)
_SECTION_ALT = re.compile(
    r'^(?:Section|SECTION)\s+(\d+\.\d+)\s*[:\-–—]?\s*(.{2,80})$',
    re.MULTILINE
)

def extract_keywords(text: str, top_n: int = 12) -> list[str]:
    """Extract meaningful keywords using TF weighting."""
    STOPWORDS = {
        'a','an','the','is','it','in','on','at','to','for','of','and','or',
        'but','with','this','that','are','was','be','as','by','from','which',
        'have','has','had','not','can','will','would','should','may','also',
        'into','than','then','when','where','these','those','their','they',
        'such','both','each','more','most','some','all','been','very'
    }
    words = re.findall(r'[a-zA-Z][a-z]{2,}', text)
    filtered = [w.lower() for w in words if w.lower() not in STOPWORDS and len(w) > 3]
    counts = Counter(filtered)
    return [w for w, _ in counts.most_common(top_n)]

# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class Paragraph:
    id: str
    text: str
    page: int
    chapter_num: int
    chapter_title: str
    section_num: str          # e.g. "13.2"
    section_title: str
    paragraph_position: int   # position within section (0-indexed)
    semantic_type: str
    keywords: list[str]
    char_start: int
    char_end: int
    embedding: Optional[list[float]] = None
    word_count: int = 0

    def __post_init__(self):
        self.word_count = len(self.text.split())

@dataclass
class Section:
    num: str
    title: str
    chapter_num: int
    page_start: int
    paragraphs: list[Paragraph] = field(default_factory=list)

@dataclass
class Chapter:
    num: int
    title: str
    page_start: int
    sections: dict = field(default_factory=dict)  # section_num → Section

@dataclass
class HierarchicalIndex:
    book_id: str
    book_title: str
    book_author: str
    indexed_at: str
    total_paragraphs: int
    chapters: dict = field(default_factory=dict)  # chapter_num → Chapter

    def all_paragraphs(self) -> list[Paragraph]:
        paras = []
        for ch in self.chapters.values():
            for sec in ch.sections.values():
                paras.extend(sec.paragraphs)
        return paras

    def get_paragraph(self, para_id: str) -> Optional[Paragraph]:
        for p in self.all_paragraphs():
            if p.id == para_id:
                return p
        return None


# ── PDF text extraction ───────────────────────────────────────────────────────

def extract_pages_from_pdf(pdf_path: str) -> list[dict]:
    """Returns list of {page_num, text} dicts."""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            raise RuntimeError("Install pypdf: pip install pypdf")

    reader = PdfReader(pdf_path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        # Clean up common PDF extraction artifacts
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'(\w)-\s+(\w)', r'\1\2', text)  # fix hyphenation
        pages.append({"page_num": i, "text": text.strip()})
        if i % 50 == 0:
            logger.info(f"  Extracted page {i}/{len(reader.pages)}")
    return pages


def extract_pages_from_chunks_json(chunks_json: list) -> list[dict]:
    """
    Build page list from an existing chunks.json (already in your R2).
    Each chunk: {page, text, ...}
    Groups chunks by page number.
    """
    pages_map = defaultdict(list)
    for chunk in chunks_json:
        page = chunk.get('page', 0)
        text = chunk.get('text', '')
        if text:
            pages_map[page].append(text)
    return [
        {"page_num": p, "text": "\n".join(texts)}
        for p, texts in sorted(pages_map.items())
    ]


# ── Structure detector ────────────────────────────────────────────────────────

def _build_structure_map(pages: list[dict]) -> list[dict]:
    """
    Scan all pages to detect chapter and section boundaries.
    Returns list of {type, num, title, page_num} sorted by page.
    """
    boundaries = []
    full_text_with_pages = []

    for page in pages:
        pnum = page["page_num"]
        text = page["text"]
        full_text_with_pages.append((pnum, text))

        # Chapter boundaries
        for m in _CHAPTER_RE.finditer(text):
            ch_num = int(m.group(1))
            ch_title = m.group(2).strip().rstrip('.')
            boundaries.append({
                "type": "chapter", "num": ch_num,
                "title": ch_title, "page_num": pnum
            })

        # Section boundaries
        for m in _SECTION_RE.finditer(text):
            sec_num = m.group(1)
            sec_title = m.group(2).strip().rstrip('.')
            ch_num = int(sec_num.split('.')[0])
            boundaries.append({
                "type": "section", "num": sec_num,
                "title": sec_title, "page_num": pnum,
                "chapter_num": ch_num
            })

        for m in _SECTION_ALT.finditer(text):
            sec_num = m.group(1)
            sec_title = m.group(2).strip().rstrip('.')
            ch_num = int(sec_num.split('.')[0])
            boundaries.append({
                "type": "section", "num": sec_num,
                "title": sec_title, "page_num": pnum,
                "chapter_num": ch_num
            })

    # Deduplicate (same chapter/section detected on same page)
    seen = set()
    deduped = []
    for b in boundaries:
        key = (b["type"], str(b["num"]))
        if key not in seen:
            seen.add(key)
            deduped.append(b)

    return sorted(deduped, key=lambda x: x["page_num"])


# ── Paragraph splitter ────────────────────────────────────────────────────────

def _split_into_paragraphs(text: str, min_words: int = 15, max_words: int = 300) -> list[str]:
    """
    Splits page text into meaningful paragraphs.
    Handles both explicit newlines and sentence-boundary splitting.
    """
    # Try splitting on double newlines first
    raw_chunks = re.split(r'\n{2,}', text)
    paragraphs = []

    for chunk in raw_chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        words = chunk.split()

        if len(words) < min_words:
            # Too short — try merging with previous
            if paragraphs:
                paragraphs[-1] = paragraphs[-1] + ' ' + chunk
            else:
                paragraphs.append(chunk)
        elif len(words) > max_words:
            # Too long — split at sentence boundaries
            sentences = re.split(r'(?<=[.!?])\s+', chunk)
            current = []
            for sent in sentences:
                current.append(sent)
                if len(' '.join(current).split()) >= 80:
                    paragraphs.append(' '.join(current))
                    current = []
            if current:
                paragraphs.append(' '.join(current))
        else:
            paragraphs.append(chunk)

    # Filter empty / too short
    return [p for p in paragraphs if len(p.split()) >= min_words]


# ── Main indexer ──────────────────────────────────────────────────────────────

class HierarchicalIndexer:
    """
    Converts a textbook (PDF or existing chunks.json) into a
    structured hierarchical index with chapter/section/page/paragraph
    addressing and optional semantic embeddings.
    """

    def __init__(self, openrouter_api_key: str = "", embedding_model: str = "openai/text-embedding-3-small"):
        self.api_key = openrouter_api_key
        self.embedding_model = embedding_model
        self._embed_cache: dict = {}

    def _generate_id(self, ch: int, sec: str, page: int, pos: int) -> str:
        raw = f"ch{ch:02d}_s{sec}_p{page:04d}_{pos:04d}"
        return re.sub(r'[^a-zA-Z0-9_]', '_', raw)

    def _embed_batch(self, texts: list[str], batch_size: int = 20) -> list[Optional[list[float]]]:
        """Embed a batch of texts via OpenRouter. Returns None on failure."""
        if not self.api_key:
            return [None] * len(texts)

        results = [None] * len(texts)
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            try:
                resp = requests.post(
                    "https://openrouter.ai/api/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://chunks-ai.vercel.app",
                        "X-Title": "VAKS Indexer"
                    },
                    json={"model": self.embedding_model, "input": batch},
                    timeout=30
                )
                if resp.status_code == 200:
                    data = resp.json()["data"]
                    for j, item in enumerate(data):
                        results[i + j] = item["embedding"]
                else:
                    logger.warning(f"Embedding API {resp.status_code}: {resp.text[:200]}")
                time.sleep(0.1)  # Rate limit buffer
            except Exception as e:
                logger.warning(f"Embedding batch failed: {e}")

        return results

    def build_from_pdf(
        self, pdf_path: str,
        book_id: str, book_title: str, book_author: str,
        embed: bool = True
    ) -> 'HierarchicalIndex':
        logger.info(f"📖 Building index from PDF: {pdf_path}")
        pages = extract_pages_from_pdf(pdf_path)
        return self._build_index(pages, book_id, book_title, book_author, embed)

    def build_from_chunks(
        self, chunks_json: list,
        book_id: str, book_title: str, book_author: str,
        embed: bool = True
    ) -> 'HierarchicalIndex':
        logger.info(f"📖 Building index from {len(chunks_json)} existing chunks")
        pages = extract_pages_from_chunks_json(chunks_json)
        return self._build_index(pages, book_id, book_title, book_author, embed)

    def _build_index(
        self, pages: list[dict],
        book_id: str, book_title: str, book_author: str,
        embed: bool
    ) -> 'HierarchicalIndex':

        logger.info(f"  Pages extracted: {len(pages)}")
        boundaries = _build_structure_map(pages)
        chapters_detected = [b for b in boundaries if b["type"] == "chapter"]
        sections_detected = [b for b in boundaries if b["type"] == "section"]
        logger.info(f"  Structure: {len(chapters_detected)} chapters, {len(sections_detected)} sections detected")

        # If structure detection failed (e.g. scanned PDF), create synthetic structure
        if len(chapters_detected) == 0:
            logger.warning("  No chapters detected — creating synthetic 10-page chapter groups")
            for i, page_group_start in enumerate(range(1, len(pages), 10), start=1):
                boundaries.append({
                    "type": "chapter", "num": i,
                    "title": f"Chapter {i}",
                    "page_num": pages[page_group_start - 1]["page_num"]
                })
            for i, page in enumerate(pages, start=1):
                group = ((i - 1) // 3) + 1
                ch = ((i - 1) // 10) + 1
                boundaries.append({
                    "type": "section",
                    "num": f"{ch}.{group % 10}",
                    "title": f"Section {ch}.{group % 10}",
                    "page_num": page["page_num"],
                    "chapter_num": ch
                })
            boundaries.sort(key=lambda x: x["page_num"])

        # Build page → (chapter, section) lookup
        page_to_chapter: dict[int, int] = {}
        page_to_section: dict[int, str] = {}

        sorted_bounds = sorted(boundaries, key=lambda x: x["page_num"])
        current_ch = 1
        current_ch_title = "Introduction"
        current_sec = "1.0"
        current_sec_title = "Overview"

        for page in pages:
            pnum = page["page_num"]
            # Update current chapter/section for this page
            for b in sorted_bounds:
                if b["page_num"] <= pnum:
                    if b["type"] == "chapter":
                        current_ch = b["num"]
                        current_ch_title = b["title"]
                    elif b["type"] == "section":
                        current_sec = str(b["num"])
                        current_sec_title = b["title"]
                else:
                    break
            page_to_chapter[pnum] = current_ch
            page_to_section[pnum] = current_sec

        # ── Build full index ──────────────────────────────────────────────
        index = HierarchicalIndex(
            book_id=book_id,
            book_title=book_title,
            book_author=book_author,
            indexed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            total_paragraphs=0,
            chapters={}
        )

        # Pre-populate chapters and sections
        for b in sorted_bounds:
            if b["type"] == "chapter":
                ch_num = b["num"]
                if ch_num not in index.chapters:
                    index.chapters[ch_num] = Chapter(
                        num=ch_num, title=b["title"], page_start=b["page_num"]
                    )
            elif b["type"] == "section":
                ch_num = b.get("chapter_num", int(str(b["num"]).split('.')[0]))
                if ch_num not in index.chapters:
                    index.chapters[ch_num] = Chapter(
                        num=ch_num, title=f"Chapter {ch_num}", page_start=b["page_num"]
                    )
                sec_num = str(b["num"])
                if sec_num not in index.chapters[ch_num].sections:
                    index.chapters[ch_num].sections[sec_num] = Section(
                        num=sec_num, title=b["title"],
                        chapter_num=ch_num, page_start=b["page_num"]
                    )

        # ── Assign paragraphs ─────────────────────────────────────────────
        section_para_counts: dict[str, int] = defaultdict(int)
        all_paragraphs_text: list[str] = []
        paragraph_metadata: list[dict] = []

        for page in pages:
            pnum = page["page_num"]
            ch_num = page_to_chapter.get(pnum, 1)
            sec_num = page_to_section.get(pnum, "1.0")

            # Ensure chapter/section exist
            if ch_num not in index.chapters:
                index.chapters[ch_num] = Chapter(
                    num=ch_num, title=f"Chapter {ch_num}", page_start=pnum
                )
            ch = index.chapters[ch_num]
            if sec_num not in ch.sections:
                ch.sections[sec_num] = Section(
                    num=sec_num, title=f"Section {sec_num}",
                    chapter_num=ch_num, page_start=pnum
                )
            sec = ch.sections[sec_num]

            raw_paragraphs = _split_into_paragraphs(page["text"])
            char_offset = 0
            for para_text in raw_paragraphs:
                pos = section_para_counts[sec_num]
                section_para_counts[sec_num] += 1
                para_id = self._generate_id(ch_num, sec_num, pnum, pos)
                keywords = extract_keywords(para_text)
                stype = detect_semantic_type(para_text)

                para = Paragraph(
                    id=para_id,
                    text=para_text,
                    page=pnum,
                    chapter_num=ch_num,
                    chapter_title=ch.title,
                    section_num=sec_num,
                    section_title=sec.title,
                    paragraph_position=pos,
                    semantic_type=stype,
                    keywords=keywords,
                    char_start=char_offset,
                    char_end=char_offset + len(para_text),
                    embedding=None,
                    word_count=len(para_text.split())
                )
                char_offset += len(para_text) + 1
                sec.paragraphs.append(para)
                all_paragraphs_text.append(para_text)
                paragraph_metadata.append({"para_id": para_id, "ch": ch_num, "sec": sec_num})

        total = len(all_paragraphs_text)
        index.total_paragraphs = total
        logger.info(f"  Total paragraphs: {total}")

        # ── Generate embeddings ───────────────────────────────────────────
        if embed and self.api_key:
            logger.info(f"  Generating embeddings for {total} paragraphs...")
            embeddings = self._embed_batch(all_paragraphs_text)
            for i, meta in enumerate(paragraph_metadata):
                ch = index.chapters[meta["ch"]]
                sec = ch.sections[meta["sec"]]
                for para in sec.paragraphs:
                    if para.id == meta["para_id"]:
                        para.embedding = embeddings[i]
                        break
            embedded_count = sum(1 for e in embeddings if e is not None)
            logger.info(f"  Embeddings generated: {embedded_count}/{total}")
        else:
            logger.info("  Skipping embeddings (no API key or embed=False)")

        return index

    # ── Serialization ─────────────────────────────────────────────────────────

    def save_index(self, index: HierarchicalIndex, output_path: str):
        """Serialize to JSON. Embeddings stored as float16 lists for space efficiency."""
        data = {
            "metadata": {
                "book_id": index.book_id,
                "book_title": index.book_title,
                "book_author": index.book_author,
                "indexed_at": index.indexed_at,
                "total_paragraphs": index.total_paragraphs,
                "schema_version": "1.0"
            },
            "chapters": {}
        }
        for ch_num, ch in index.chapters.items():
            data["chapters"][str(ch_num)] = {
                "num": ch.num,
                "title": ch.title,
                "page_start": ch.page_start,
                "sections": {}
            }
            for sec_num, sec in ch.sections.items():
                data["chapters"][str(ch_num)]["sections"][sec_num] = {
                    "num": sec.num,
                    "title": sec.title,
                    "chapter_num": sec.chapter_num,
                    "page_start": sec.page_start,
                    "paragraphs": []
                }
                for p in sec.paragraphs:
                    p_dict = asdict(p)
                    # Quantize embeddings to float16 to halve storage size
                    if p_dict.get("embedding"):
                        p_dict["embedding"] = [round(float(x), 5) for x in p_dict["embedding"]]
                    data["chapters"][str(ch_num)]["sections"][sec_num]["paragraphs"].append(p_dict)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        logger.info(f"✅ Index saved: {output_path} ({size_mb:.1f} MB)")

    def load_index(self, index_path: str) -> HierarchicalIndex:
        """Load a saved index from disk."""
        with open(index_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        meta = data["metadata"]
        index = HierarchicalIndex(
            book_id=meta["book_id"],
            book_title=meta["book_title"],
            book_author=meta["book_author"],
            indexed_at=meta["indexed_at"],
            total_paragraphs=meta["total_paragraphs"]
        )
        for ch_key, ch_data in data["chapters"].items():
            ch = Chapter(num=ch_data["num"], title=ch_data["title"], page_start=ch_data["page_start"])
            for sec_key, sec_data in ch_data["sections"].items():
                sec = Section(
                    num=sec_data["num"], title=sec_data["title"],
                    chapter_num=sec_data["chapter_num"], page_start=sec_data["page_start"]
                )
                for p_data in sec_data["paragraphs"]:
                    para = Paragraph(**p_data)
                    sec.paragraphs.append(para)
                ch.sections[sec_key] = sec
            index.chapters[int(ch_key)] = ch
        logger.info(f"✅ Index loaded: {meta['total_paragraphs']} paragraphs")
        return index


# ── CLI usage ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    if len(sys.argv) < 3:
        print("Usage: python hierarchical_indexer.py <pdf_path> <output.json> [book_id] [title] [author]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    out_path = sys.argv[2]
    book_id = sys.argv[3] if len(sys.argv) > 3 else "textbook"
    title = sys.argv[4] if len(sys.argv) > 4 else "Textbook"
    author = sys.argv[5] if len(sys.argv) > 5 else "Unknown"
    api_key = os.environ.get("OPENROUTER_API_KEY", "")

    indexer = HierarchicalIndexer(openrouter_api_key=api_key)
    idx = indexer.build_from_pdf(pdf_path, book_id, title, author, embed=bool(api_key))
    indexer.save_index(idx, out_path)
    print(f"\n✅ Done. Indexed {idx.total_paragraphs} paragraphs into {out_path}")
