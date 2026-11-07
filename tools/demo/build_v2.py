#!/usr/bin/env python3
# HEART RELAY デモ動画 v2 編集（ffmpeg）。v1 素材を再利用。ナレーション v2（文ごとの時刻）に合わせてカット長を決め、字幕は文単位で同期。
import json, os, subprocess, glob, sys

W, H, FPS = 1920, 1080, 30
S1 = glob.glob('raw/s1/page@d673*.webm')[0]
BOARD = glob.glob('raw/s1/page@3211*.webm')[0]
S2 = glob.glob('raw/s2/*.webm')[0]
CORP = glob.glob('raw/corp/*.webm')[0]
ACK = 'raw/ack/page@4d63bebf9058682dcdc7abc0ea08291f.webm'
PX = 'px_cfr.mp4'
NAR = 'narration_v2'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'heart-relay_demo_v2.mp4'
SEG = 'seg2'; os.makedirs(SEG, exist_ok=True)
timing = json.load(open(f'{NAR}/timing.json', encoding='utf-8'))
SKIP = os.environ.get('SKIP_SEGS') == '1'

def ff(args):
    if SKIP and args[-1].startswith(SEG + '/') and args[-1] != f'{SEG}/all.mp4' and os.path.exists(args[-1]): return
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)
def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode().strip())
def nar_len(nid): return timing[nid]['total']

def pc_seg(src, t_in, t_out, out, slow=1.0, hold=0.0, crop=None):
    vf = []
    if crop: vf.append(f'crop={crop}')
    vf.append(f'scale={W}:{H}:flags=lanczos')
    if slow != 1.0: vf.append(f'setpts={slow}*PTS')
    vf.append(f'fps={FPS}')
    if hold > 0: vf.append(f'tpad=stop_mode=clone:stop_duration={hold:.3f}')
    ff(['-ss', str(t_in), '-to', str(t_out), '-i', src, '-vf', ','.join(vf), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS), out])
def still_seg(png, seconds, out):
    ff(['-loop', '1', '-framerate', str(FPS), '-t', f'{seconds:.3f}', '-i', png, '-vf', f'scale={W}:{H},format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])
def mobile_seg(src, t_in, t_out, out, slow=1.0, hold=0.0):
    h = 1000; w = round(390 * h / 844 / 2) * 2
    vf = (f'[0:v]scale={w}:{h}:flags=lanczos' + (f',setpts={slow}*PTS' if slow != 1.0 else '') + f',fps={FPS}[m];'
          f'color=c=0x123b36:s={W}x{H}:r={FPS}[bg];[bg][m]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p')
    if hold > 0: vf += f',tpad=stop_mode=clone:stop_duration={hold:.3f}'
    ff(['-ss', str(t_in), '-to', str(t_out), '-i', src, '-filter_complex', vf, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])
def split_seg(px, px_in, px_out, pc, pc_in, out, total):
    ph = 1000; pw = round(482 * ph / 1080 / 2) * 2
    pc_w = 1380; pc_h = round(pc_w * 900 / 1600 / 2) * 2
    gap = (W - pw - pc_w) // 3
    vf = (f'[0:v]trim={px_in}:{px_out},setpts=PTS-STARTPTS,scale={pw}:{ph}:flags=lanczos,fps={FPS},tpad=stop_mode=clone:stop_duration=30[p];'
          f'[1:v]trim={pc_in}:{pc_in + (px_out - px_in)},setpts=PTS-STARTPTS,scale={pc_w}:{pc_h}:flags=lanczos,fps={FPS},tpad=stop_mode=clone:stop_duration=30[c];'
          f'color=c=0x123b36:s={W}x{H}:r={FPS}[bg];[bg][p]overlay={gap}:(H-h)/2[b1];[b1][c]overlay={gap*2+pw}:(H-h)/2,trim=0:{total:.3f},format=yuv420p')
    ff(['-i', px, '-i', pc, '-filter_complex', vf, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])

cuts = []
def add(name, f): cuts.append((name, f)); print(name, round(dur(f), 2), 's')
def need(nid, video_len, pad=0.6):  # ナレーションに合わせて末尾に足す静止時間
    return max(0.0, nar_len(nid) + pad - video_len)

# 00 課題提示（新規）  01 タイトル
still_seg('slide_problem.png', nar_len('00') + 0.8, f'{SEG}/00.mp4'); add('00', f'{SEG}/00.mp4')
still_seg('slide_title.png', nar_len('01') + 0.8, f'{SEG}/01.mp4'); add('01', f'{SEG}/01.mp4')
# 02 ホーム→新規（やや遅く）
v = (5.9 - 0.3) * 1.3; pc_seg(S1, 0.3, 5.9, f'{SEG}/02.mp4', slow=1.3, hold=need('02', v)); add('02', f'{SEG}/02.mp4')
# 03 FAX 取り込み→転記→追記→反映→解析ボタン
v = 16.5 - 5.9; pc_seg(S1, 5.9, 16.5, f'{SEG}/03.mp4', hold=need('03', v)); add('03', f'{SEG}/03.mp4')
# 04 解析結果（待ち省略）
v = (44.6 - 41.0) * 1.5; pc_seg(S1, 41.0, 44.6, f'{SEG}/04.mp4', slow=1.5, hold=need('04', v)); add('04', f'{SEG}/04.mp4')
# 05 宛先・除外
v = (48.3 - 44.6) * 1.6; pc_seg(S1, 44.6, 48.3, f'{SEG}/05.mp4', slow=1.6, hold=need('05', v)); add('05', f'{SEG}/05.mp4')
# 06 届け方→承認→配信（0.85 倍速）→ 共有ボード
pc_seg(S1, 48.3, 59.5, f'{SEG}/06a.mp4', slow=0.85); add('06a', f'{SEG}/06a.mp4')
pc_seg(BOARD, 0.6, 5.9, f'{SEG}/06b.mp4', crop='1024:768:0:0'); add('06b', f'{SEG}/06b.mp4')
# 07 スマホ（入力は 0.85 倍速）→ 候補 → 選択（待ち省略）→ 宛先 → 配信
mobile_seg(S2, 0.2, 13.2, f'{SEG}/07a.mp4', slow=0.85); add('07a', f'{SEG}/07a.mp4')
v07 = dur(f'{SEG}/07a.mp4') + (49.6 - 41.4)
mobile_seg(S2, 41.4, 49.6, f'{SEG}/07b.mp4', hold=need('07', v07)); add('07b', f'{SEG}/07b.mp4')
# 08 Pixel ＋ PC 反映（タップ 15.8s → PC ✅ 30.4s を約 1 秒後に）
PX_IN, PX_OUT = 4.0, 21.0
pc_in = 30.4 - ((15.8 - PX_IN) + 1.0)
split_seg(PX, PX_IN, PX_OUT, ACK, pc_in, f'{SEG}/08.mp4', total=max(PX_OUT - PX_IN, nar_len('08') + 0.6)); add('08', f'{SEG}/08.mp4')
# 09 法人内連絡（文面作成の待ち省略、後半 1/0.7 倍速）
pc_seg(CORP, 0.2, 12.0, f'{SEG}/09a.mp4'); add('09a', f'{SEG}/09a.mp4')
pc_seg(CORP, 18.0, 41.2, f'{SEG}/09b.mp4', slow=0.7, hold=0.4); add('09b', f'{SEG}/09b.mp4')
# 10 まとめ
still_seg('slide_end.png', nar_len('10') + 1.2, f'{SEG}/10.mp4'); add('10', f'{SEG}/10.mp4')

with open(f'{SEG}/list.txt', 'w') as f:
    for _, p in cuts: f.write(f"file '{os.path.abspath(p)}'\n")
ff(['-f', 'concat', '-safe', '0', '-i', f'{SEG}/list.txt', '-c', 'copy', f'{SEG}/all.mp4'])
t = 0.0; starts = {}; lens = {}
for name, p in cuts: starts[name] = t; lens[name] = dur(p); t += lens[name]
total = t
json.dump({'starts': starts, 'lens': lens, 'total': total}, open(f'{SEG}/timeline.json', 'w'), ensure_ascii=False, indent=1)
print('total', round(total, 1), 's')

# ---- ナレーション開始位置（カット頭 + オフセット）。09 は 09a の頭から 09b にまたがる ----
nar_pos = {nid: starts[v['cut']] + 0.3 for nid, v in timing.items()}
for nid, v in timing.items():
    assert nar_pos[nid] + v['total'] <= total + 0.01, (nid, 'narration overruns')

# ---- 字幕（ASS）: ナレーション文に同期 + 注記 + 常時タグ ----
def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f'{h}:{m:02d}:{s:05.2f}'
def disp(text):  # 読み用表記を表示用に
    return text.replace('クロード', 'Claude').replace('アンドロイド', 'Android').replace('PC', 'PC')
ass = ['[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', 'WrapStyle: 0', '',
       '[V4+ Styles]',
       'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
       'Style: Main,Noto Sans CJK JP,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H9A000000,1,0,0,0,100,100,0,0,3,14,0,2,80,80,64,1',
       'Style: Note,Noto Sans CJK JP,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8A000000,0,0,0,0,100,100,0,0,3,10,0,8,40,40,30,1',
       'Style: Tag,Noto Sans CJK JP,22,&H00F0F0F0,&H00FFFFFF,&H00000000,&H7A000000,0,0,0,0,100,100,0,0,3,6,0,3,24,24,12,1',
       '', '[Events]', 'Format: Layer, Style, Start, End, Name, MarginL, MarginR, MarginV, Effect, Text']
for nid, v in timing.items():
    if v['cut'] in ('00', '01', '10'): continue  # スライドは本文がスライドに出ているので字幕なし
    base = nar_pos[nid]
    for i, s in enumerate(v['sentences']):
        end = s['end'] + 0.35
        if i + 1 < len(v['sentences']): end = min(end, v['sentences'][i + 1]['start'] - 0.05)
        ass.append(f"Dialogue: 0,Main,{ts(base + s['start'] - 0.1)},{ts(base + end)},,0,0,0,,{disp(s['text'])}")
notes = [
    ('03', 0.0, 6.0, '※ 画像/PDF の文字起こしは Claude。TXT/DOCX/XLSX はローカル抽出'),
    ('04', 0.0, 4.5, '※ Claude の解析待ち（約 25 秒）を短縮しています'),
    ('04', 4.5, 6.0, '※ 台帳照合は ID・氏名・カナの決定的一致。曖昧なときは職員が選びます'),
    ('07a', 0.0, 5.0, '※ 解析待ち（約 29 秒）を短縮しています'),
    ('08', 0.0, 5.0, '※ 左: Pixel 10a の実機画面収録 ／ 右: PC の配信管理'),
    ('09b', 0.0, 4.5, '※ 文面案の待ち（約 8 秒）を短縮。事業所切替は架空データの実証で認証・認可はありません'),
]
for cut, off, d, text in notes:
    s0 = starts[cut] + off; ass.append(f'Dialogue: 1,Note,{ts(s0)},{ts(s0 + d)},,0,0,0,,{text}')
ass.append(f'Dialogue: 2,Tag,{ts(starts["02"])},{ts(starts["10"])},,0,0,0,,架空データによる試作｜登場する利用者・職員・事業所はすべて架空です')
open(f'{SEG}/subs.ass', 'w', encoding='utf-8').write('\n'.join(ass) + '\n')

# ---- 音声合成・字幕焼き込み ----
inputs = ['-i', f'{SEG}/all.mp4']; fc = []; mix = []
for i, nid in enumerate(timing.keys(), start=1):
    inputs += ['-i', f'{NAR}/nar_{nid}.wav']
    delay = int(nar_pos[nid] * 1000)
    fc.append(f'[{i}:a]aformat=sample_rates=48000:channel_layouts=mono,adelay={delay}|{delay}[a{i}]'); mix.append(f'[a{i}]')
fc.append(f'{"".join(mix)}amix=inputs={len(mix)}:normalize=0,aresample=48000,apad,atrim=0:{total:.3f}[aout]')
fc.append(f"[0:v]ass={SEG}/subs.ass:fontsdir=/usr/share/fonts[vout]")
ff([*inputs, '-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT])
print('wrote', OUT, round(dur(OUT), 2), 's')
