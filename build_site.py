#!/usr/bin/env python3
"""Сборка статического SPA-сайта вики love_kb.

Сканирует wiki/{topics,concepts,entities,sources}/*.md, парсит frontmatter,
разрешает `[[wikilinks]]` во внутренние ссылки `#/p/<slug>`, считает обратные
ссылки (backlinks) и пишет единый `data/pages.json`, который грузит фронтенд.

Публикуется ТОЛЬКО вики (markdown-страницы). raw/ (полные тексты источников),
log.md, CLAUDE.md сайтом не используются. Ссылки на первоисточники (DOI/PMID/URL)
остаются в теле страниц — это просто внешние ссылки.

Usage:
    python3 build_site.py            # собрать data/pages.json
    python3 build_site.py --check    # собрать и напечатать сводку/проблемы
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
WIKI = ROOT / "wiki"
OUT = ROOT / "data" / "pages.json"

CATEGORIES = ["topics", "concepts", "entities", "sources"]
CAT_RU = {
    "topics": "Темы",
    "concepts": "Понятия",
    "entities": "Сущности",
    "sources": "Источники",
}

WIKILINK = re.compile(r"\[\[([^\]]+?)\]\]")


def parse_frontmatter(text):
    """Лёгкий парсер YAML-frontmatter (хватает для наших полей). → (meta, body)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end].strip("\n")
    body = text[end + 4:].lstrip("\n")
    meta = {}
    for line in raw.splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, val = line.split(":", 1)
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            items = [v.strip().strip("\"'") for v in val[1:-1].split(",")]
            meta[key] = [v for v in items if v]
        else:
            meta[key] = val.strip("\"'")
    return meta, body


def title_of(body, stem):
    m = re.search(r"^#\s+(.+)$", body, re.M)
    return m.group(1).strip() if m else stem


def slug_of(category, stem):
    """sources с разделителем "<id> - <title>" → <id>; остальные → имя файла.

    Для научных source-страниц без " - " (напр. `harlow-1958-nature-of-love`) split
    вернёт весь stem — слаг = имя файла. Для популярных (`vk-… - …`) — короткий id.
    """
    if category == "sources":
        return stem.split(" - ", 1)[0]
    return stem


def load_pages():
    pages = []
    for cat in CATEGORIES:
        d = WIKI / cat
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.md")):
            text = f.read_text(encoding="utf-8")
            meta, body = parse_frontmatter(text)
            stem = f.stem
            pages.append({
                "stem": stem,
                "category": cat,
                "slug": slug_of(cat, stem),
                "title": title_of(body, stem),
                "type": meta.get("type", ""),
                "tags": meta.get("tags", []),
                "_body": body,
            })
    return pages


def build_registry(pages):
    """stem → page; плюс резолв по нормализованному имени для устойчивости."""
    by_stem = {}
    for p in pages:
        by_stem[p["stem"]] = p
    return by_stem


def resolve_links(pages, registry):
    """Заменяет [[wikilink]] на markdown-ссылки; собирает рёбра графа."""
    edges = []  # (from_slug, to_slug)

    for p in pages:
        from_slug = p["slug"]
        seen = set()

        def repl(m, _from=from_slug, _seen=seen):
            inner = m.group(1)
            # `\|` — экранированный пайп в markdown-таблицах: срезаем хвостовой `\`
            target = inner.split("|", 1)[0].split("#", 1)[0].strip().rstrip("\\")
            alias = inner.split("|", 1)[1].strip() if "|" in inner else target
            if not target:
                # внутристраничный якорь `[[#раздел|текст]]` — рендерим как текст
                if not alias:
                    alias = inner.split("|", 1)[0].lstrip("#").replace("-", " ").strip()
                return alias
            dest = registry.get(target)
            if dest is None:
                # orphan — без страницы; показываем пунктиром, не ссылкой
                return f'<span class="wl-orphan" title="нет страницы">{alias}</span>'
            to_slug = dest["slug"]
            if to_slug != _from and to_slug not in _seen:
                _seen.add(to_slug)
                edges.append((_from, to_slug))
            return f"[{alias}](#/p/{to_slug})"

        p["html_md"] = WIKILINK.sub(repl, p["_body"])

    # backlinks: для каждой страницы — кто на неё ссылается
    incoming = {p["slug"]: [] for p in pages}
    by_slug = {p["slug"]: p for p in pages}
    for src, dst in edges:
        if dst in incoming and src in by_slug:
            incoming[dst].append(src)
    for p in pages:
        seen, bl = set(), []
        for s in incoming[p["slug"]]:
            if s in seen:
                continue
            seen.add(s)
            sp = by_slug[s]
            bl.append({"slug": s, "title": sp["title"], "category": sp["category"]})
        bl.sort(key=lambda x: x["title"].lower())
        p["backlinks"] = bl

    return edges


def main(argv=None):
    ap = argparse.ArgumentParser(description="Сборка SPA-сайта bania_kb.")
    ap.add_argument("--check", action="store_true", help="печатать сводку и orphan-ссылки")
    args = ap.parse_args(argv)

    pages = load_pages()
    registry = build_registry(pages)
    edges = resolve_links(pages, registry)

    out_pages = [{
        "slug": p["slug"],
        "stem": p["stem"],
        "category": p["category"],
        "title": p["title"],
        "type": p["type"],
        "tags": p["tags"],
        "md": p["html_md"],
        "backlinks": p["backlinks"],
    } for p in pages]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "categories": [{"key": c, "label": CAT_RU[c]} for c in CATEGORIES],
        "pages": out_pages,
    }
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    n_by_cat = {c: sum(1 for p in pages if p["category"] == c) for c in CATEGORIES}
    print(f"pages: {len(pages)}  " + "  ".join(f"{c}={n_by_cat[c]}" for c in CATEGORIES))
    print(f"links (внутренних рёбер): {len(edges)}")
    print(f"→ {OUT.relative_to(ROOT)}  ({OUT.stat().st_size // 1024} KB)")

    if args.check:
        orphans = {}
        for p in pages:
            for m in WIKILINK.finditer(p["_body"]):
                t = m.group(1).split("|", 1)[0].split("#", 1)[0].strip().rstrip("\\")
                if t and t not in registry:
                    orphans[t] = orphans.get(t, 0) + 1
        top = sorted(orphans.items(), key=lambda x: -x[1])[:15]
        print(f"orphan wikilink-целей (нет страницы): {len(orphans)}; топ:")
        for t, c in top:
            print(f"  {c:3d}  {t}")


if __name__ == "__main__":
    main()
