from pathlib import Path

ROOT = Path(__file__).resolve().parent
JS = ROOT / 'js'
FILES = [
    '01-config.js',
    '02-utils.js',
    '03-services.js',
    '04-views.js',
    '05-ui.js',
    '06-main.js',
]

out = []
for name in FILES:
    out.append(f'/* ===== {name} ===== */\n')
    out.append((JS / name).read_text(encoding='utf-8'))
    out.append('\n')

(JS / 'app.js').write_text('\n'.join(out), encoding='utf-8')
print('Built js/app.js successfully.')
