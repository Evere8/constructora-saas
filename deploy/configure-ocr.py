"""Run on the VPS: sudo python3 app/deploy/configure-ocr.py.

Secrets stay in the existing server env file, never in GitHub or the terminal output.
"""

import getpass
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request


def main():
    destination = Path('/opt/constructora/app.env')
    if not destination.is_file():
        raise SystemExit('No existe /opt/constructora/app.env; no se modificó nada.')
    print('Conectar lectura visual de planos y manuscritos a OpenAI.')
    print('Usa una clave de API de tu proyecto de OpenAI con saldo habilitado.')
    key = getpass.getpass('Pega la clave de API (no se mostrará): ').strip()
    if not re.fullmatch(r'sk-[A-Za-z0-9_-]+', key):
        raise SystemExit('Formato de clave inválido; no se modificó nada.')
    model = input('Modelo [gpt-5.4]: ').strip() or 'gpt-5.4'
    if not re.fullmatch(r'[A-Za-z0-9._-]+', model):
        raise SystemExit('Nombre de modelo inválido.')
    request = urllib.request.Request(
        'https://api.openai.com/v1/responses',
        data=json.dumps({'model': model, 'store': False, 'input': 'Responde OK.',
                         'max_output_tokens': 2048}).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        if result.get('status') != 'completed':
            raise SystemExit('OpenAI respondió de forma incompleta; no se modificó nada.')
    except urllib.error.HTTPError as error:
        hints = {401: 'Clave inválida', 403: 'Sin acceso al modelo',
                 429: 'Sin saldo o límite de uso alcanzado'}
        raise SystemExit(f'OpenAI: {hints.get(error.code, "revise el modelo")} '
                         f'(HTTP {error.code}). No se modificó nada.') from None
    except (urllib.error.URLError, TimeoutError):
        raise SystemExit('No se pudo conectar con OpenAI; no se modificó nada.') from None
    settings = {'OPENAI_API_KEY': key, 'OPENAI_OCR_MODEL': model,
                'ELONGATION_OCR_PROVIDER': 'openai'}
    lines = destination.read_text().splitlines()
    lines = [line for line in lines if line.partition('=')[0].strip() not in settings]
    lines.extend(f'{name}={value}' for name, value in settings.items())
    stat = destination.stat()
    fd, filename = tempfile.mkstemp(prefix='.ocr-env-', dir=destination.parent)
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, stat.st_uid, stat.st_gid)
        with os.fdopen(fd, 'w') as output:
            output.write('\n'.join(lines) + '\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(filename, destination)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)
    print('OPENAI_OK. Configuración guardada. Ahora reconstruye API y frontend.')


if __name__ == '__main__':
    main()
