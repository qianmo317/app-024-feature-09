// 现场登记：大输入谜号、重复登记提示、长按快速登记、统计、兑奖号码、大屏模式
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../ui/router';
import { CATEGORY_LABEL, FORMAT_LABEL, type RiddleCategory } from '../types';
import { formatDateTime } from '../lib/format';
import { EMPTY_FILTERS, allTags, filterRiddles } from '../lib/search';
import { store } from '../lib/store';

const QUICK_PRIZE_IDX = 0; // 长按快速登记使用第一个奖项

export function Onsite() {
  const state = useAppState();
  const [noInput, setNoInput] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [winner, setWinner] = useState('');
  const [prize, setPrize] = useState(state.settings.prizes[0] ?? '');
  const [note, setNote] = useState('');
  const [bigScreen, setBigScreen] = useState(false);
  // 大屏放映批次：谜目/难度/标签筛选 + 顺序/随机两种放式 + 已猜中跳过开关
  const [bigCat, setBigCat] = useState<RiddleCategory | ''>('');
  const [bigDiff, setBigDiff] = useState<0 | 1 | 2 | 3>(0);
  const [bigTag, setBigTag] = useState('');
  const [bigMode, setBigMode] = useState<'seq' | 'random'>('seq');
  const [skipSolved, setSkipSolved] = useState(true);
  const [bigIdx, setBigIdx] = useState(0);
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(new Set()); // 本轮随机已抽中的谜条 id
  const [currentDraw, setCurrentDraw] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const stats = store.stats();
  const byNo = useMemo(() => new Map(state.riddles.map((r) => [r.no, r])), [state.riddles]);
  const recordsOfCurrent = current != null
    ? state.records.filter((r) => r.riddleId === byNo.get(current)?.id)
    : [];
  const currentRiddle = current != null ? byNo.get(current) : undefined;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const lookup = (noStr: string) => {
    const no = parseInt(noStr.trim(), 10);
    if (!noStr.trim() || Number.isNaN(no)) { setMsg({ kind: 'bad', text: '请输入谜号数字' }); return; }
    const r = byNo.get(no);
    if (!r) { setMsg({ kind: 'bad', text: `找不到谜号 ${no}，请核对谜条` }); setCurrent(null); return; }
    setCurrent(no);
    const prior = state.records.filter((x) => x.riddleId === r.id);
    if (prior.length) {
      setMsg({ kind: 'warn', text: `谜号 ${no} 已于 ${formatDateTime(prior[0].at)} 由「${prior[0].winnerName || '匿名'}」登记过（重复登记提示）` });
    } else {
      setMsg({ kind: 'ok', text: `谜号 ${no} 未登记，可登记猜中` });
    }
  };

  const register = async (quick = false) => {
    if (!currentRiddle) return;
    if (state.records.some((x) => x.riddleId === currentRiddle.id)) {
      setMsg({ kind: 'warn', text: `谜号 ${currentRiddle.no} 已登记过，请勿重复登记（如需修改请在下方列表删除后重登）` });
      return;
    }
    await store.addRecord({
      riddleId: currentRiddle.id,
      winnerName: quick ? '' : winner.trim(),
      prize: quick ? (state.settings.prizes[QUICK_PRIZE_IDX] ?? '') : prize,
      note: quick ? '长按快速登记' : note.trim() || undefined,
    });
    setMsg({ kind: 'ok', text: `谜号 ${currentRiddle.no} 已登记${quick ? '（快速登记）' : ` · ${winner.trim() || '匿名'} · ${prize}`}` });
    if (!quick) { setWinner(''); setNote(''); }
    inputRef.current?.focus();
  };

  // 长按快速登记（600ms）
  const pressTimer = useRef<number | null>(null);
  const pressStart = () => {
    pressTimer.current = window.setTimeout(() => { void register(true); pressTimer.current = null; }, 600);
  };
  const pressCancel = () => {
    if (pressTimer.current != null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  // 已猜中的谜条（登记记录按 riddleId 关联）
  const solvedIds = useMemo(() => new Set(state.records.map((r) => r.riddleId)), [state.records]);
  const tagOptions = useMemo(() => allTags(state.riddles), [state.riddles]);
  // 当前放映批次：先按谜目/难度/标签挑出一批，「跳过已猜中」开启时再剔除已登记谜条
  const bigBatch = useMemo(() => {
    let list = filterRiddles(state.riddles, { ...EMPTY_FILTERS, category: bigCat, difficulty: bigDiff, tag: bigTag });
    if (skipSolved) list = list.filter((r) => !solvedIds.has(r.id));
    return list;
  }, [state.riddles, bigCat, bigDiff, bigTag, skipSolved, solvedIds]);

  const seqIdx = bigBatch.length ? Math.min(bigIdx, bigBatch.length - 1) : 0;
  const bigRiddle = bigMode === 'seq'
    ? bigBatch[seqIdx]
    : bigBatch.find((r) => r.id === currentDraw);
  const bigSolved = bigRiddle ? solvedIds.has(bigRiddle.id) : false;

  // 随机模式：本轮抽过的不再入池，抽完给提示
  const randomPool = useMemo(() => bigBatch.filter((r) => !drawn.has(r.id)), [bigBatch, drawn]);
  const randomDrawnCount = bigBatch.length - randomPool.length;
  const randomExhausted = bigMode === 'random' && bigBatch.length > 0 && randomPool.length === 0;

  const hintPinyin = useMemo(() => {
    if (!bigRiddle || !state.ctx.loaded) return '';
    const chars = Array.from(bigRiddle.answer.replace(/\s+/g, ''));
    return chars.map((c) => {
      const py = state.ctx.pinyin.get(c)?.[0];
      return py ? py[0].toUpperCase() : '？';
    }).join('·');
  }, [bigRiddle, state.ctx]);

  // 换一批（筛选/模式/跳过开关任一变化）或进出大屏时，清掉放映进度与已抽记录
  const resetBigSession = () => {
    setBigIdx(0);
    setDrawn(new Set());
    setCurrentDraw(null);
    setHintLevel(0);
  };

  const openBigScreen = () => { resetBigSession(); setBigScreen(true); };
  const closeBigScreen = () => {
    setBigScreen(false);
    resetBigSession();
    setBigCat(''); setBigDiff(0); setBigTag('');
    setBigMode('seq'); setSkipSolved(true);
  };

  const bigGo = (delta: number) => { setHintLevel(0); setBigIdx((i) => Math.min(bigBatch.length - 1, Math.max(0, i + delta))); };

  const drawRandom = () => {
    if (!randomPool.length) return;
    const pick = randomPool[Math.floor(Math.random() * randomPool.length)];
    const next = new Set(drawn);
    next.add(pick.id);
    setDrawn(next);
    setCurrentDraw(pick.id);
    setHintLevel(0);
  };

  const exportRecords = () => {
    // 登记表导出在设置页；此处提供快捷入口
    location.hash = '#/settings';
  };

  return (
    <div>
      <div className="page-head">
        <h1>现场登记</h1>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={openBigScreen}>🖥 大屏模式</button>
          <button className="btn" onClick={exportRecords}>导出登记表</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><b>{stats.total}</b><span>谜条总数</span></div>
        <div className="stat stat-ok"><b>{stats.solved}</b><span>已猜中</span></div>
        <div className="stat"><b>{stats.remaining}</b><span>剩余</span></div>
        <div className="stat"><b>{stats.prizes}</b><span>奖品发放</span></div>
      </div>

      <div className="onsite-grid">
        <div className="panel">
          <h3>按谜号登记</h3>
          <div className="onsite-input-row">
            <input
              ref={inputRef}
              className="input onsite-no"
              type="text"
              inputMode="numeric"
              placeholder="输入谜号"
              value={noInput}
              onChange={(e) => setNoInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') lookup(noInput); }}
            />
            <button className="btn btn-primary btn-lg" onClick={() => lookup(noInput)}>查找</button>
          </div>
          {msg && <p className={`msg msg-${msg.kind}`}>{msg.text}</p>}

          {currentRiddle && (
            <div className="onsite-current">
              <div className="onsite-no-big">{currentRiddle.no}</div>
              <div>
                <p className="onsite-surface">{currentRiddle.surface}</p>
                <p className="muted">
                  （{CATEGORY_LABEL[currentRiddle.category]}
                  {currentRiddle.format !== 'none' ? ` · ${FORMAT_LABEL[currentRiddle.format]}` : ''}）
                  　谜底：<b className="onsite-answer">{currentRiddle.answer}</b>
                </p>
                {recordsOfCurrent.length > 0 && (
                  <ul className="dup-list warn-text">
                    {recordsOfCurrent.map((r) => (
                      <li key={r.id}>已有登记：{r.winnerName || '匿名'} · {r.prize} · {formatDateTime(r.at)}{r.code ? ` · ${r.code}` : ''}</li>
                    ))}
                  </ul>
                )}
                <div className="field-row">
                  <label className="field"><span>猜中者姓名</span>
                    <input className="input" value={winner} onChange={(e) => setWinner(e.target.value)} placeholder="可留空" />
                  </label>
                  <label className="field"><span>奖项</span>
                    <select className="input" value={prize} onChange={(e) => setPrize(e.target.value)}>
                      {(state.settings.prizes.length ? state.settings.prizes : ['']).map((p) => <option key={p} value={p}>{p || '（无）'}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>备注</span>
                    <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                </div>
                <div className="btn-row">
                  <button
                    className="btn btn-primary btn-lg"
                    disabled={recordsOfCurrent.length > 0}
                    onClick={() => register(false)}
                  >
                    ✓ 登记猜中
                  </button>
                  <button
                    className="btn btn-lg"
                    disabled={recordsOfCurrent.length > 0}
                    title="长按 0.6 秒快速登记（第一个奖项）"
                    onPointerDown={pressStart}
                    onPointerUp={pressCancel}
                    onPointerLeave={pressCancel}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    长按快速登记
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h3>登记记录（{state.records.length}）</h3>
          <div className="btn-row" style={{ marginBottom: 8 }}>
            <button className="btn" onClick={() => void store.generatePrizeCodes().then((n) => setMsg({ kind: 'ok', text: `已生成 ${n} 个兑奖号码（DJ-xxxx）` }))}>
              🎫 生成兑奖号码
            </button>
          </div>
          {state.records.length === 0 ? (
            <p className="muted">还没有登记记录。</p>
          ) : (
            <div className="table-wrap records-table">
              <table>
                <thead><tr><th>谜号</th><th>猜中者</th><th>奖项</th><th>兑奖号</th><th>时间</th><th /></tr></thead>
                <tbody>
                  {state.records.slice(0, 30).map((rec) => {
                    const r = state.riddles.find((x) => x.id === rec.riddleId);
                    return (
                      <tr key={rec.id}>
                        <td className="no-cell">{r?.no ?? '?'}</td>
                        <td>{rec.winnerName || '匿名'}</td>
                        <td>{rec.prize}</td>
                        <td>{rec.code ?? ''}</td>
                        <td className="muted">{formatDateTime(rec.at)}</td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => void store.removeRecord(rec.id)}>删</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {state.records.length > 30 && <p className="muted">… 仅显示最近 30 条</p>}
            </div>
          )}
        </div>
      </div>

      {bigScreen && (
        <div className="bigscreen" role="dialog" aria-label="现场大屏">
          <div className="bigscreen-bar no-print">
            <label className="bigscreen-field">谜目
              <select value={bigCat} onChange={(e) => { setBigCat(e.target.value as RiddleCategory | ''); resetBigSession(); }}>
                <option value="">全部</option>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="bigscreen-field">难度
              <select value={String(bigDiff)} onChange={(e) => { setBigDiff(Number(e.target.value) as 0 | 1 | 2 | 3); resetBigSession(); }}>
                <option value="0">全部</option>
                <option value="1">★☆☆</option>
                <option value="2">★★☆</option>
                <option value="3">★★★</option>
              </select>
            </label>
            <label className="bigscreen-field">标签
              <select value={bigTag} onChange={(e) => { setBigTag(e.target.value); resetBigSession(); }}>
                <option value="">全部</option>
                {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="bigscreen-field">模式
              <select value={bigMode} onChange={(e) => { setBigMode(e.target.value as 'seq' | 'random'); resetBigSession(); }}>
                <option value="seq">顺序放映</option>
                <option value="random">随机抽取</option>
              </select>
            </label>
            <label className="bigscreen-check">
              <input
                type="checkbox"
                checked={skipSolved}
                onChange={(e) => { setSkipSolved(e.target.checked); resetBigSession(); }}
              />
              跳过已猜中
            </label>
          </div>

          {bigRiddle ? (
            <>
              <div className="bigscreen-top">
                <span className="bigscreen-no">{bigRiddle.no}</span>
                <span className="bigscreen-cat">
                  （{CATEGORY_LABEL[bigRiddle.category]}
                  {bigRiddle.format !== 'none' ? ` · ${FORMAT_LABEL[bigRiddle.format]}` : ''}）
                </span>
                {bigSolved && <span className="bigscreen-solved">✓ 已猜中</span>}
              </div>
              <div className="bigscreen-surface">{bigRiddle.surface}</div>
              {hintLevel >= 1 && <p className="bigscreen-hint">提示 1：谜底共 {Array.from(bigRiddle.answer.replace(/\s+/g, '')).length} 个字</p>}
              {hintLevel >= 2 && <p className="bigscreen-hint">提示 2：首字「{Array.from(bigRiddle.answer.replace(/\s+/g, ''))[0]}」</p>}
              {hintLevel >= 3 && <p className="bigscreen-hint">提示 3：拼音首字母 {hintPinyin || '（无拼音数据）'}</p>}
            </>
          ) : (
            <div className="bigscreen-empty">
              {bigBatch.length === 0
                ? '本批没有可放映的谜条，请调整筛选，或取消「跳过已猜中」'
                : '点击「随机抽取」开始抽谜'}
            </div>
          )}

          <div className="bigscreen-ctrls no-print">
            {bigMode === 'seq' ? (
              <>
                <button className="btn btn-lg" onClick={() => bigGo(-1)} disabled={seqIdx <= 0}>← 上一条</button>
                <button className="btn btn-lg" onClick={() => setHintLevel((h) => Math.min(3, h + 1))} disabled={!bigRiddle || hintLevel >= 3}>💡 分级提示（{hintLevel}/3）</button>
                <button className="btn btn-lg" onClick={() => bigGo(1)} disabled={seqIdx >= bigBatch.length - 1}>下一条 →</button>
              </>
            ) : (
              <>
                <button className="btn btn-lg" onClick={drawRandom} disabled={randomPool.length === 0}>🎲 随机抽取</button>
                <button className="btn btn-lg" onClick={() => setHintLevel((h) => Math.min(3, h + 1))} disabled={!bigRiddle || hintLevel >= 3}>💡 分级提示（{hintLevel}/3）</button>
              </>
            )}
            <button className="btn btn-ghost btn-lg" onClick={closeBigScreen}>退出大屏</button>
          </div>

          {randomExhausted && (
            <p className="bigscreen-done no-print">🎉 本批 {bigBatch.length} 条已全部抽完，换一批或退出大屏重新进入后可再抽</p>
          )}
          <p className="bigscreen-count no-print">
            {bigMode === 'seq'
              ? (bigBatch.length ? `${seqIdx + 1} / ${bigBatch.length}${bigRiddle ? ` · 第 ${bigRiddle.no} 号` : ''}` : '本批 0 条')
              : `已抽 ${randomDrawnCount} / 共 ${bigBatch.length} 条`}
            {skipSolved ? ' · 已猜中自动跳过' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
