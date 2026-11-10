"""Text normalisation for the search index. Pure functions, shared by the indexer and the query side so a
query is tokenised exactly the way names were indexed.

- normalise: lower-case, strip accents, keep letters/digits, collapse spaces ("Shubhang D'Souza" → "shubhang dsouza")
- edge n-grams: every prefix of every word, 1..MAX_GRAM chars, so typing "shu" hits "shubhang" with an index
  seek instead of a regex scan
- phonetic: a Soundex-style key per word for spelling variants common in Indian names (Rau/Rao, Sharma/Sarma)
"""

import re
import unicodedata

MAX_GRAM = 16
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")
_SOUNDEX = {
    c: d
    for d, letters in {"1": "bfpv", "2": "cgjkqsxz", "3": "dt", "4": "l", "5": "mn", "6": "r"}.items()
    for c in letters
}


def normalise(text: str) -> str:
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    t = t.replace("'", "").replace("’", "")
    t = _NON_ALNUM.sub(" ", t)
    return " ".join(t.split())


def words(text: str) -> list[str]:
    return normalise(text).split()


def edge_ngrams(text: str) -> list[str]:
    out: set[str] = set()
    for w in words(text):
        for n in range(1, min(len(w), MAX_GRAM) + 1):
            out.add(w[:n])
    return sorted(out)


def soundex(word: str) -> str:
    w = normalise(word).replace(" ", "")
    if not w or not w[0].isalpha():
        return ""
    # Common Indian-English spelling merges before the standard pass (Shubhang/Subhang, Qureshi/Kureshi, Chetan/Ketan).
    w = re.sub(r"^sh", "s", w)
    w = w.replace("ph", "f").replace("ee", "i").replace("oo", "u").replace("aa", "a")
    first = {"q": "k", "c": "k", "z": "s", "x": "s"}.get(w[0], w[0])
    codes: list[str] = []
    last = _SOUNDEX.get(first, "")
    for ch in w[1:]:
        code = _SOUNDEX.get(ch, "")
        if code and code != last:
            codes.append(code)
        if ch not in "hw":
            last = code
    return (first + "".join(codes) + "000")[:4]


def phonetic(text: str) -> list[str]:
    return sorted({k for k in (soundex(w) for w in words(text)) if k})
