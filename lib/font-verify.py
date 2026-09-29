from fontTools.ttLib import TTFont
import json
import os
import sys

source, text_file, *outputs = sys.argv[1:]
requested = {ord(char) for char in open(text_file, encoding='utf-8').read() if char not in '\r\n\t'}

def details(filename):
    font = TTFont(filename)
    try:
        points = set()
        for table in font['cmap'].tables:
            if table.isUnicode():
                points.update(table.cmap)
        names = set()
        notices = set()
        if 'name' in font:
            for name in font['name'].names:
                try:
                    if name.toUnicode().strip():
                        names.add(name.nameID)
                    if name.nameID in (0, 13, 14):
                        notices.add((name.nameID, name.platformID, name.platEncID, name.langID, name.toBytes()))
                except (UnicodeError, LookupError):
                    pass
        return points, names, notices
    finally:
        font.close()

source_points, source_names, source_notices = details(source)
supported = requested & source_points
if not supported:
    raise ValueError('源字体不支持任何请求字符，无法安全替换')
first_points = None
result = []
for output in outputs:
    points, names, notices = details(output)
    if supported - points:
        raise ValueError(f'{output} 缺少请求字符：{sorted(supported - points)[:12]}')
    if (source_names & {0, 1, 2, 4, 6, 13, 14}) - names:
        raise ValueError(f'{output} 未保留源字体名称记录 ID：{sorted((source_names & {0, 1, 2, 4, 6, 13, 14}) - names)}')
    if source_notices - notices:
        raise ValueError(f'{output} 未保留版权或授权名称记录')
    if first_points is not None and first_points != points:
        raise ValueError(f'{output} 与同族其他格式 cmap 不一致')
    first_points = points
    result.append({'format': os.path.splitext(output)[1][1:], 'bytes': os.path.getsize(output), 'characters': len(points)})
print(json.dumps({'requested': len(requested), 'supported': len(supported), 'sourceMissing': sorted(requested - source_points), 'outputs': result}))
