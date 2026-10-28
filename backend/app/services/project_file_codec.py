"""Lossless, conditional compression for operational Drive documents.

The content hash and size in MySQL always describe the original file.  The
encoding is an internal storage detail; downloaded bytes must match exactly.
"""

import gzip
import zlib

MIN_SAVINGS_BYTES = 1024
MIN_SAVINGS_PERCENT = 5


def encode(content: bytes) -> tuple[bytes, str]:
    compressed = gzip.compress(content, compresslevel=6, mtime=0)
    savings = len(content) - len(compressed)
    if savings >= MIN_SAVINGS_BYTES and savings * 100 >= len(content) * MIN_SAVINGS_PERCENT:
        return compressed, "gzip"
    return content, "identity"


def decode(stored: bytes, encoding: str, original_size: int) -> bytes:
    if encoding == "identity":
        if len(stored) != original_size:
            raise ValueError("Tamaño original distinto al registrado")
        return stored
    if encoding != "gzip" or original_size < 0:
        raise ValueError("Codificación de archivo desconocida")
    try:
        decoder = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)
        content = decoder.decompress(stored, original_size + 1)
        if (
            len(content) != original_size
            or not decoder.eof
            or decoder.unused_data
            or decoder.unconsumed_tail
        ):
            raise ValueError("Archivo comprimido incompleto o con tamaño inesperado")
        return content
    except zlib.error as exc:
        raise ValueError("Archivo comprimido dañado") from exc
