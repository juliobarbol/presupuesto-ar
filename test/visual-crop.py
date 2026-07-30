#!/usr/bin/env python3
"""Recorta la misma region de las capturas base/ y check/ de visual-snap.cjs
y las apila (arriba base, abajo check) para mirar una diferencia de cerca.

Cuando `visual-snap.cjs check` marca una escena, esto sirve para ver QUE
cambio en vez de adivinarlo. Sin dependencias: decodifica y escribe PNG a mano.

Uso:  python3 test/visual-crop.py <escena> <x0> <x1> <y0> <y1> [escala] [salida]
Ej:   python3 test/visual-crop.py editor-normal 0 412 830 940 2 /tmp/dif.png"""
import sys, zlib, struct

def decode(f):
    buf = open(f, 'rb').read(); pos = 8; idat = []
    w = h = ch = 0
    while pos < len(buf):
        ln = int.from_bytes(buf[pos:pos+4], 'big')
        t = buf[pos+4:pos+8].decode(); d = buf[pos+8:pos+8+ln]
        if t == 'IHDR':
            w = int.from_bytes(d[0:4], 'big'); h = int.from_bytes(d[4:8], 'big')
            ch = {0:1, 2:3, 4:2, 6:4}[d[9]]
        elif t == 'IDAT': idat.append(d)
        elif t == 'IEND': break
        pos += 12 + ln
    raw = zlib.decompress(b''.join(idat)); stride = w*ch
    out = bytearray(h*stride); rp = 0
    for y in range(h):
        fl = raw[rp]; rp += 1
        line = raw[rp:rp+stride]; rp += stride
        base = y*stride; pbase = (y-1)*stride
        for x in range(stride):
            a = out[base+x-ch] if x >= ch else 0
            b = out[pbase+x] if y else 0
            c = out[pbase+x-ch] if (y and x >= ch) else 0
            v = line[x]
            if fl == 1: v += a
            elif fl == 2: v += b
            elif fl == 3: v += (a+b)//2
            elif fl == 4:
                p = a+b-c; pa = abs(p-a); pb = abs(p-b); pc = abs(p-c)
                v += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            out[base+x] = v & 0xff
    return w, h, ch, out

def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb[y*w*3:(y+1)*w*3]) for y in range(h))
    def ck(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + ck(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + ck(b'IDAT', zlib.compress(raw)) + ck(b'IEND', b''))

scene, X0, X1, Y0, Y1 = sys.argv[1], *map(int, sys.argv[2:6])
S = int(sys.argv[6]) if len(sys.argv) > 6 else 2
dst = sys.argv[7] if len(sys.argv) > 7 else 'crop.png'
cw = X1-X0
rows = bytearray()
for tag in ('base', 'check'):
    w, h, ch, d = decode(f'/tmp/presupuesto-visual-snap/{tag}/{scene}.png')
    for y in range(Y0, min(Y1, h)):
        row = bytearray()
        for x in range(X0, min(X1, w)):
            i = (y*w+x)*ch
            row += bytes(d[i:i+3])
        row += bytes([200, 200, 200]) * max(0, cw - (min(X1, w)-X0))
        scaled = bytes(b for p in range(cw) for b in row[p*3:p*3+3]*S)
        for _ in range(S): rows += scaled
    for _ in range(S*2): rows += bytes([255, 0, 0]*cw*S)
th = len(rows)//(cw*S*3)
open(dst, 'wb').write(png(cw*S, th, rows))
print(f'{dst}: {cw*S}x{th}  (arriba=base, abajo=check)')
