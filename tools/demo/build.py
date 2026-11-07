#!/usr/bin/env python3
# HEART RELAY デモ動画 編集スクリプト（ffmpeg）。素材: raw/*（Playwright/adb 収録）, narration/*.wav, slide_*.png
import json, os, subprocess, glob, sys

W, H, FPS = 1920, 1080, 30
S1 = glob.glob('raw/s1/page@d673*.webm')[0]
BOARD = glob.glob('raw/s1/page@3211*.webm')[0]
S2 = glob.glob('raw/s2/*.webm')[0]
CORP = glob.glob('raw/corp/*.webm')[0]
ACK = 'raw/ack/page@4d63bebf9058682dcdc7abc0ea08291f.webm'
PX = 'px_cfr.mp4'  # Pixel screenrecord を 30fps CFR / 高さ1080 に変換済み
OUT = sys.argv[1] if len(sys.argv) > 1 else 'heart-relay_demo_v1.mp4'
os.makedirs('seg', exist_ok=True)

SKIP = os.environ.get('SKIP_SEGS') == '1'
def ff(args):
    if SKIP and args[-1].startswith('seg/') and args[-1] != 'seg/all.mp4' and os.path.exists(args[-1]): return
    cmd = ['ffmpeg', '-v', 'error', '-y', *args]
    subprocess.run(cmd, check=True)

def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode().strip())

# PC 画面（1600x900）を 1920x1080 に拡大。speed>1 でゆっくり（setpts）
def pc_seg(src, t_in, t_out, out, slow=1.0, hold=0.0, crop=None):
    vf = []
    if crop: vf.append(f'crop={crop}')
    vf.append(f'scale={W}:{H}:flags=lanczos')
    if slow != 1.0: vf.append(f'setpts={slow}*PTS')
    vf.append(f'fps={FPS}')
    if hold > 0: vf.append(f'tpad=stop_mode=clone:stop_duration={hold}')
    ff(['-ss', str(t_in), '-to', str(t_out), '-i', src, '-vf', ','.join(vf), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS), out])

def still_seg(png, seconds, out):
    ff(['-loop', '1', '-framerate', str(FPS), '-t', str(seconds), '-i', png, '-vf', f'scale={W}:{H},format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])

# スマホ幅（390x844）: 中央に拡大配置、背景はダークグラデ風の単色
def mobile_seg(src, t_in, t_out, out, hold=0.0):
    h = 1000; w = round(390 * h / 844 / 2) * 2
    vf = (f'[0:v]scale={w}:{h}:flags=lanczos,fps={FPS}[m];'
          f'color=c=0x123b36:s={W}x{H}:r={FPS}[bg];[bg][m]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p')
    if hold > 0: vf += f',tpad=stop_mode=clone:stop_duration={hold}'
    ff(['-ss', str(t_in), '-to', str(t_out), '-i', src, '-filter_complex', vf, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])

# Pixel（左）＋ PC 配信管理（右）の 2 画面
def split_seg(px, px_in, px_out, pc, pc_in, pc_out, out):
    ph = 1000; pw = round(482 * ph / 1080 / 2) * 2
    pc_w = 1380; pc_h = round(pc_w * 900 / 1600 / 2) * 2
    gap = (W - pw - pc_w) // 3
    vf = (f'[0:v]trim={px_in}:{px_out},setpts=PTS-STARTPTS,scale={pw}:{ph}:flags=lanczos,fps={FPS}[p];'
          f'[1:v]trim={pc_in}:{pc_out},setpts=PTS-STARTPTS,scale={pc_w}:{pc_h}:flags=lanczos,fps={FPS},tpad=stop_mode=clone:stop_duration=20[c];'
          f'color=c=0x123b36:s={W}x{H}:r={FPS}[bg];[bg][p]overlay={gap}:(H-h)/2:shortest=1[b1];[b1][c]overlay={gap*2+pw}:(H-h)/2:shortest=1,format=yuv420p')
    ff(['-i', px, '-i', pc, '-filter_complex', vf, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])

cuts = []  # (name, file)
def add(name, f): cuts.append((name, f)); print(name, round(dur(f), 2), 's')

# 1 タイトル
still_seg('slide_title.png', 13, 'seg/01.mp4'); add('01', 'seg/01.mp4')
# 2 ホーム→新規
pc_seg(S1, 0.3, 5.9, 'seg/02.mp4'); add('02', 'seg/02.mp4')
# 3 FAX 取り込み→転記→1語修正→反映→解析ボタン
pc_seg(S1, 5.9, 16.5, 'seg/03.mp4'); add('03', 'seg/03.mp4')
# 4 解析結果（待ち 16.5→41.0 を省略）: 利用者特定・要約（ゆっくり）
pc_seg(S1, 41.0, 44.6, 'seg/04.mp4', slow=2.0, hold=1.0); add('04', 'seg/04.mp4')
# 5 宛先・除外（ゆっくり）
pc_seg(S1, 44.6, 48.3, 'seg/05.mp4', slow=2.2, hold=1.0); add('05', 'seg/05.mp4')
# 6 届け方「両方」→承認→配信 → 共有ボード
pc_seg(S1, 48.3, 59.5, 'seg/06a.mp4')
pc_seg(BOARD, 0.6, 5.9, 'seg/06b.mp4', crop='1024:768:0:0')
add('06a', 'seg/06a.mp4'); add('06b', 'seg/06b.mp4')
# 7 スマホ: 入力→候補→選択（待ち 13.2→41.4 省略）→宛先→配信
mobile_seg(S2, 0.2, 13.2, 'seg/07a.mp4'); add('07a', 'seg/07a.mp4')
mobile_seg(S2, 41.4, 49.6, 'seg/07b.mp4', hold=1.0); add('07b', 'seg/07b.mp4')
# 8 Pixel ＋ PC 反映（Pixel 側の「確認しました」タップ ≈ 15s、PC 側の ✅ ≈ 30.4s を揃える）
PX_IN, PX_OUT = 4.0, 21.0
px_ack = 15.8 - PX_IN + 1.0  # PC の反映はタップの約 1 秒後に見せる
pc_in = 30.4 - px_ack
split_seg(PX, PX_IN, PX_OUT, ACK, pc_in, pc_in + (PX_OUT - PX_IN), 'seg/08.mp4'); add('08', 'seg/08.mp4')
# 9 法人内連絡（文面作成の待ち 12.0→18.0 を省略、後半はやや早送り）
pc_seg(CORP, 0.2, 12.0, 'seg/09a.mp4'); add('09a', 'seg/09a.mp4')
pc_seg(CORP, 18.0, 41.2, 'seg/09b.mp4', slow=0.8, hold=0.5); add('09b', 'seg/09b.mp4')
# 10 まとめ
still_seg('slide_end.png', 8, 'seg/10.mp4'); add('10', 'seg/10.mp4')

# 連結
with open('seg/list.txt', 'w') as f:
    for _, p in cuts: f.write(f"file '{os.path.abspath(p)}'\n")
ff(['-f', 'concat', '-safe', '0', '-i', 'seg/list.txt', '-c', 'copy', 'seg/all.mp4'])

# タイムライン（字幕・音声の配置に使う）
t = 0.0; starts = {}
for name, p in cuts:
    starts[name] = t; t += dur(p)
total = t
json.dump({'starts': starts, 'total': total}, open('seg/timeline.json', 'w'), ensure_ascii=False, indent=1)
print('total', round(total, 1), 's')

# ---- 字幕（ASS） ----
def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f'{h}:{m:02d}:{s:05.2f}'
subs = [  # (start cut, offset, duration, text)
    ('02', 0.0, 5.0, '① 入力：PC・スマホ・ファイル・音声から'),
    ('03', 0.0, 5.0, 'FAX 画像を取り込む → Claude が原文を転記'),
    ('03', 5.0, 5.5, '職員が確認・修正してから解析へ（ここでは 1 語追記）'),
    ('04', 0.0, 8.0, '架空 200 名の台帳から 坂井 夏子さん（ID 0466）を特定'),
    ('05', 0.0, 9.0, '宛先は送迎コース 2 の担当だけ。他コースは理由付きで除外'),
    ('06a', 0.0, 6.0, '届け方「両方」→ 人が承認して配信'),
    ('06a', 6.0, 4.5, '配信完了 → 配信管理に記録'),
    ('06b', 0.0, 5.3, 'フロアの共有ボードにも掲示（タブレット用）'),
    ('07a', 0.0, 6.5, 'スマホから直接入力'),
    ('07a', 6.5, 6.5, '同姓同名は自動確定しない → 職員が候補から選ぶ'),
    ('07b', 0.0, 9.0, '火木土の利用者を選ぶと、担当コース 3 の職員だけが宛先に'),
    ('08', 0.0, 8.0, 'Android アプリ：受信箱 → 詳細 → 「確認しました」'),
    ('08', 8.0, 9.0, 'PC の配信管理に「誰が・いつ確認したか」が即時反映'),
    ('09a', 0.0, 6.0, '法人内連絡：デイサービス → 老健 へ'),
    ('09a', 6.0, 5.8, '既存の連絡から要点を転記 → 「AI で文面を整える」'),
    ('09b', 0.0, 6.0, 'Claude の文面案を人が編集 → 送信は人の操作のみ'),
    ('09b', 6.0, 7.0, '受信側（老健）で確認'),
    ('09b', 13.0, 6.0, '送信側に「確認済」が戻る'),
]
notes = [  # 小さめの注記（上段）
    ('03', 0.0, 10.6, '※ 画像/PDF 転記は Claude、TXT/DOCX/XLSX はローカル抽出'),
    ('04', 0.0, 4.0, '※ Claude 解析の待ち（約 25 秒）を短縮'),
    ('09b', 0.0, 4.0, '※ 文面作成の待ち（約 8 秒）を短縮'),
]
ass = ['[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', 'WrapStyle: 0', '',
       '[V4+ Styles]',
       'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
       'Style: Main,Noto Sans CJK JP,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H9A000000,1,0,0,0,100,100,0,0,3,14,0,2,60,60,64,1',
       'Style: Note,Noto Sans CJK JP,32,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8A000000,0,0,0,0,100,100,0,0,3,10,0,8,40,40,30,1',
       'Style: Tag,Noto Sans CJK JP,22,&H00F0F0F0,&H00FFFFFF,&H00000000,&H7A000000,0,0,0,0,100,100,0,0,3,6,0,3,24,24,12,1',
       '', '[Events]', 'Format: Layer, Style, Start, End, Name, MarginL, MarginR, MarginV, Effect, Text']
for cut, off, d, text in subs:
    s = starts[cut] + off; ass.append(f'Dialogue: 0,Main,{ts(s)},{ts(s + d)},,0,0,0,,{text}')
for cut, off, d, text in notes:
    s = starts[cut] + off; ass.append(f'Dialogue: 1,Note,{ts(s)},{ts(s + d)},,0,0,0,,{text}')
ass.append(f'Dialogue: 2,Tag,{ts(starts["02"])},{ts(starts["10"])},,0,0,0,,登場する利用者・職員・事業所はすべて架空のデータです')
open('seg/subs.ass', 'w', encoding='utf-8').write('\n'.join(ass) + '\n')

# ---- ナレーション配置 ----
nar = {'01': ('01', 0.4), '02': ('02', 0.3), '03': ('03', 0.3), '04': ('04', 0.2), '05': ('05', 0.2), '06': ('06a', 0.3),
       '07': ('07a', 0.5), '08': ('08', 0.5), '09': ('09a', 0.3), '11': ('10', 0.4)}
inputs = ['-i', 'seg/all.mp4']; fc = []; mix = []
for i, (nid, (cut, off)) in enumerate(nar.items(), start=1):
    inputs += ['-i', f'narration/nar_{nid}.wav']
    delay = int((starts[cut] + off) * 1000)
    fc.append(f'[{i}:a]aformat=sample_rates=48000:channel_layouts=mono,adelay={delay}|{delay}[a{i}]'); mix.append(f'[a{i}]')
fc.append(f'{"".join(mix)}amix=inputs={len(mix)}:normalize=0,aresample=48000,apad,atrim=0:{total:.3f}[aout]')
fc.append(f"[0:v]ass=seg/subs.ass:fontsdir=/usr/share/fonts[vout]")
ff([*inputs, '-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT])
print('wrote', OUT, round(dur(OUT), 2), 's')
