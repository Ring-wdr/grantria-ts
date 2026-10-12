#!/usr/bin/env python3
"""Render reference map PNGs with the Python compositor for pixel comparison in the web viewer.

Usage: python -I tools/build_ref_maps.py [MAP_ID ...]   (default: 18 36 108) -> web/public/ref/m%03d.png
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grantria_gfx as gg  # noqa: E402

ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, 'apk', 'assets')
OUT = os.path.join(ROOT, 'public', 'ref')

ids = [int(a) for a in sys.argv[1:]] or [18, 36, 108]
for i in ids:
    path = os.path.join(OUT, 'm%03d.png' % i)
    print(gg.render_map(ASSETS, i, path))
