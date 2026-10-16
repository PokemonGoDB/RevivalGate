#!/usr/bin/env python3
"""Fraction of pixels that differ between two screenshots: pixdiff.py A B"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from tile import load  # noqa: E402
a, b = load(sys.argv[1]), load(sys.argv[2])
n = sum(1 for ra, rb in zip(a, b) for pa, pb in zip(ra, rb) if pa != pb)
print(f"{n / (len(a) * len(a[0])):.3f}")
