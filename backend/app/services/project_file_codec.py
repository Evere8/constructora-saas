"""Lossless, conditional compression for operational Drive documents.

The content hash and size in MySQL always describe the original file.  The
encoding is an internal storage detail; downloaded bytes must match exactly.
"""

import gzip
import hashlib
import zlib
from pathlib import Path

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


def encode_path(source: Path, compressed: Path) -> tuple[Path, str, int, int, str]:
    """Hash and conditionally gzip a file without retaining it in memory."""
    digest = hashlib.sha256()
    original_size = 0
    with source.open("rb") as reader, compressed.open("wb") as raw_writer:
        with gzip.GzipFile(fileobj=raw_writer, mode="wb", compresslevel=6, mtime=0) as writer:
            while chunk := reader.read(1024 * 1024):
                digest.update(chunk)
                original_size += len(chunk)
                writer.write(chunk)
    compressed_size = compressed.stat().st_size
    savings = original_size - compressed_size
    if savings >= MIN_SAVINGS_BYTES and savings * 100 >= original_size * MIN_SAVINGS_PERCENT:
        return compressed, "gzip", original_size, compressed_size, digest.hexdigest()
    compressed.unlink(missing_ok=True)
    return source, "identity", original_size, original_size, digest.hexdigest()


def verify_path(
    stored: Path,
    encoding: str,
    expected_size: int,
    expected_sha256: str,
) -> None:
    digest = hashlib.sha256()
    total = 0
    opener = gzip.open if encoding == "gzip" else open
    if encoding not in {"identity", "gzip"}:
        raise ValueError("Codificación de archivo desconocida")
    try:
        with opener(stored, "rb") as reader:
            while chunk := reader.read(1024 * 1024):
                digest.update(chunk)
                total += len(chunk)
    except (OSError, EOFError) as exc:
        raise ValueError("Archivo almacenado dañado") from exc
    if total != expected_size or digest.hexdigest() != expected_sha256:
        raise ValueError("La integridad del archivo no coincide")


def decode_path(
    stored: Path,
    output: Path,
    encoding: str,
    expected_size: int,
    expected_sha256: str,
) -> None:
    digest = hashlib.sha256()
    total = 0
    opener = gzip.open if encoding == "gzip" else open
    if encoding not in {"identity", "gzip"}:
        raise ValueError("Codificación de archivo desconocida")
    try:
        with opener(stored, "rb") as reader, output.open("wb") as writer:
            while chunk := reader.read(1024 * 1024):
                digest.update(chunk)
                total += len(chunk)
                writer.write(chunk)
    except (OSError, EOFError) as exc:
        raise ValueError("Archivo almacenado dañado") from exc
    if total != expected_size or digest.hexdigest() != expected_sha256:
        output.unlink(missing_ok=True)
        raise ValueError("La integridad del archivo no coincide")
