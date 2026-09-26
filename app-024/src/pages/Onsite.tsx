// 现场登记：大输入谜号、重复登记提示、长按快速登记、统计、兑奖号码、
// 大屏模式（按谜目/难度/标签挑批 → 顺序放映或随机不重复抽取；已猜中默认跳过并可在标题标出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../ui/router';
import { CATEGORY_LABEL, FORMAT_LABEL } from '../types';
import { formatDateTime } from '../lib/format';
import { store } from '../lib/store';
import { EMPTY_FILTERS, allTags, filterRiddles, type RiddleFilters } from '../lib/search';
import type { Riddle } from '../types';

const QUICK_PRIZE_IDX = 0; // 长按快速登记使用第一个奖项

type BigMode = 'seq' | 'random';

export function Onsite() {
  const state = useAppState();
  const [noInput, setNoInput] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [winner, setWinner] = useState('');
  const [prize, setPrize] = useState(state.settings.prizes[0] ?? '');
  const [note, setNote] = useState('');

  // ---- 大屏模式 ----
  const [bigScreen, setBigScreen] = useState(false);
  const [bigPhase, setBigPhase] = useState<'setup' | 'show'>('setup');
  const [bigFilters, setBigFilters] = useState<RiddleFilters>(EMPTY_FILTERS);
  const [bigMode, setBigMode] = useState<BigMode>('seq');
  const [bigIncludeSolved, setBigIncludeSolved] = useState(false);
  const [bigPool, setBigPool] = useState<Riddle[]>([]);   // 本轮冻结的放映批次
  const [bigIdx, setBigIdx] = useState(0);                 // 顺序模式位置
  const [bigDrawn, setBigDrawn] = useState<string[]>([]); // 随机模式本轮已抽（顺序即抽取次序）
  const [hintLevel, setHintLevel] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const stats = store.stats();
  const byNo = useMemo(() => new Map(state.riddles.map((r) => [r.no, r])), [state.riddles]);
  const solvedIds = useMemo(() => new Set(state.records.map((r) => r.riddleId)), [state.records]);
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

  // ---- 大屏：批次挑选与放映控制（进度/已抽均为会话级，换一批或退出即清空）----
  const allTagList = useMemo(() => allTags(state.riddles), [state.riddles]);
  // 设置页按筛选条件命中的全部谜条（含已猜中）
  const setupMatches = useMemo(
    () => filterRiddles(state.riddles, {
      ...EMPTY_FILTERS,
      category: bigFilters.category,
      difficulty: bigFilters.difficulty,
      tag: bigFilters.tag,
    }),
    [state.riddles, bigFilters],
  );
  const setupSolvedCount = useMemo(
    () => setupMatches.reduce((n, r) => n + (solvedIds.has(r.id) ? 1 : 0), 0),
    [setupMatches, solvedIds],
  );
  // 实际可放映批次：默认跳过已猜中
  const setupPool = useMemo(
    () => (bigIncludeSolved ? setupMatches : setupMatches.filter((r) => !solvedIds.has(r.id))),
    [setupMatches, bigIncludeSolved, solvedIds],
  );

  const resetBigProgress = () => {
    setBigPool([]);
    setBigIdx(0);
    setBigDrawn([]);
    setHintLevel(0);
  };

  // 进入大屏：从设置页开始，全部状态重置（重新进入从头开始）
  const openBig = () => {
    setBigFilters(EMPTY_FILTERS);
    setBigMode('seq');
    setBigIncludeSolved(false);
    resetBigProgress();
    setBigPhase('setup');
    setBigScreen(true);
  };

  // 退出大屏：清掉当前放映进度与已抽记录（含筛选设置），回到现场登记页
  const closeBig = () => {
    setBigFilters(EMPTY_FILTERS);
    setBigMode('seq');
    setBigIncludeSolved(false);
    resetBigProgress();
    setBigPhase('setup');
    setBigScreen(false);
  };

  // 换一批：回到挑选页，清掉当前放映进度与已抽记录（筛选条件保留可再调整）
  const newBatch = () => {
    resetBigProgress();
    setBigPhase('setup');
  };

  // 开始放映：按当前筛选冻结本批；随机模式先随机抽第一条
  const startRound = () => {
    if (!setupPool.length) return;
    setBigPool(setupPool);
    setBigIdx(0);
    if (bigMode === 'random') {
      const first = setupPool[Math.floor(Math.random() * setupPool.length)];
      setBigDrawn([first.id]);
    } else {
      setBigDrawn([]);
    }
    setHintLevel(0);
    setBigPhase('show');
  };

  const bigRiddle = useMemo<Riddle | undefined>(() => {
    if (bigPhase !== 'show' || !bigPool.length) return undefined;
    if (bigMode === 'random') return bigPool.find((r) => r.id === bigDrawn[bigDrawn.length - 1]);
    return bigPool[bigIdx];
  }, [bigPhase, bigPool, bigMode, bigDrawn, bigIdx]);

  const randomRemaining = useMemo(
    () => (bigMode === 'random' ? bigPool.filter((r) => !bigDrawn.includes(r.id)) : []),
    [bigMode, bigPool, bigDrawn],
  );
  const randomExhausted = bigMode === 'random' && bigPool.length > 0 && bigDrawn.length >= bigPool.length;

  const drawRandom = () => {
    if (!randomRemaining.length) return;
    const r = randomRemaining[Math.floor(Math.random() * randomRemaining.length)];
    setBigDrawn((d) => [...d, r.id]);
    setHintLevel(0);
  };

  const bigGo = (delta: number) => {
    setHintLevel(0);
    setBigIdx((i) => Math.min(bigPool.length - 1, Math.max(0, i + delta)));
  };

  const hintPinyin = useMemo(() => {
    if (!bigRiddle || !state.ctx.loaded) return '';
    const chars = Array.from(bigRiddle.answer.replace(/\s+/g, ''));
    return chars.map((c) => {
      const py = state.ctx.pinyin.get(c)?.[0];
      return py ? py[0].toUpperCase() : '？';
    }).join('·');
  }, [bigRiddle, state.ctx]);

  const filterDesc = [
    bigFilters.category ? CATEGORY_LABEL[bigFilters.category] : '全部谜目',
    bigFilters.difficulty ? '★'.repeat(bigFilters.difficulty) : '全部难度',
    bigFilters.tag ? `标签：${bigFilters.tag}` : '',
  ].filter(Boolean).join(' · ');

  const exportRecords = () => {
    // 登记表导出在设置页；此处提供快捷入口
    location.hash = '#/settings';
  };

  return (
    <div>
      <div className="page-head">
        <h1>现场登记</h1>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={openBig}>🖥 大屏模式</button>
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

      {bigScreen && bigPhase === 'setup' && (
        <div className="bigscreen" role="dialog" aria-label="现场大屏设置">
          <div className="bigscreen-setup-card">
            <h2>大屏放映 · 挑选本批谜条</h2>
            <div className="bs-setup-row">
              <label className="field"><span>谜目</span>
                <select
                  className="input bs-cat-select"
                  value={bigFilters.category}
                  onChange={(e) => setBigFilters((f) => ({ ...f, category: e.target.value as RiddleFilters['category'] }))}
                >
                  <option value="">全部谜目</option>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="field"><span>难度</span>
                <select
                  className="input bs-diff-select"
                  value={bigFilters.difficulty}
                  onChange={(e) => setBigFilters((f) => ({ ...f, difficulty: Number(e.target.value) as RiddleFilters['difficulty'] }))}
                >
                  <option value={0}>全部难度</option>
                  <option value={1}>★</option><option value={2}>★★</option><option value={3}>★★★</option>
                </select>
              </label>
              {allTagList.length > 0 && (
                <label className="field"><span>标签</span>
                  <select
                    className="input bs-tag-select"
                    value={bigFilters.tag}
                    onChange={(e) => setBigFilters((f) => ({ ...f, tag: e.target.value }))}
                  >
                    <option value="">全部标签</option>
                    {allTagList.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="bs-mode">
              <span>放映方式</span>
              <label className="check-inline">
                <input type="radio" name="big-mode" checked={bigMode === 'seq'} onChange={() => setBigMode('seq')} /> 顺序放映
              </label>
              <label className="check-inline">
                <input className="bs-mode-random" type="radio" name="big-mode" checked={bigMode === 'random'} onChange={() => setBigMode('random')} /> 随机抽取（本轮不重复）
              </label>
            </div>

            <label className="check-inline bs-include">
              <input
                className="bs-include-solved"
                type="checkbox"
                checked={bigIncludeSolved}
                onChange={(e) => setBigIncludeSolved(e.target.checked)}
              />
              包含已猜中的谜条（默认跳过；包含时会在标题标出「已猜中」）
            </label>

            <p className="bs-setup-summary muted">
              当前筛选命中 <b>{setupMatches.length}</b> 条，其中已猜中 <b>{setupSolvedCount}</b> 条；
              {bigIncludeSolved
                ? '已勾选包含，已猜中条目将在标题标出。'
                : <>默认跳过已猜中，本批实际放映 <b className={setupPool.length ? 'ok-text' : 'bad-text'}>{setupPool.length}</b> 条。</>}
            </p>
            {setupPool.length === 0 && (
              <p className="msg msg-bad">没有可放映的谜条，请放宽筛选条件{setupSolvedCount > 0 ? '，或勾选「包含已猜中的谜条」' : ''}。</p>
            )}

            <div className="btn-row">
              <button className="btn btn-primary btn-lg" disabled={setupPool.length === 0} onClick={startRound}>
                {bigMode === 'random' ? '🎲 开始随机抽取' : '▶ 开始放映'}
              </button>
              <button className="btn btn-lg" onClick={closeBig}>退出大屏</button>
            </div>
          </div>
        </div>
      )}

      {bigScreen && bigPhase === 'show' && bigRiddle && (
        <div className="bigscreen" role="dialog" aria-label="现场大屏">
          <div className="bigscreen-top">
            <span className="bigscreen-no">{bigRiddle.no}</span>
            {solvedIds.has(bigRiddle.id) && <span className="bigscreen-solved">已猜中</span>}
            <span className="bigscreen-cat">
              （{CATEGORY_LABEL[bigRiddle.category]}
              {bigRiddle.format !== 'none' ? ` · ${FORMAT_LABEL[bigRiddle.format]}` : ''}）
            </span>
          </div>
          <div className="bigscreen-surface">{bigRiddle.surface}</div>
          {hintLevel >= 1 && <p className="bigscreen-hint">提示 1：谜底共 {Array.from(bigRiddle.answer.replace(/\s+/g, '')).length} 个字</p>}
          {hintLevel >= 2 && <p className="bigscreen-hint">提示 2：首字「{Array.from(bigRiddle.answer.replace(/\s+/g, ''))[0]}」</p>}
          {hintLevel >= 3 && <p className="bigscreen-hint">提示 3：拼音首字母 {hintPinyin || '（无拼音数据）'}</p>}
          {bigMode === 'random' && randomExhausted && (
            <p className="bigscreen-exhausted">🎯 本批 {bigPool.length} 条已全部抽完，可点「换一批」重新挑选</p>
          )}
          <div className="bigscreen-ctrls no-print">
            {bigMode === 'seq' ? (
              <>
                <button className="btn btn-lg" onClick={() => bigGo(-1)} disabled={bigIdx === 0}>← 上一条</button>
                <button className="btn btn-lg" onClick={() => setHintLevel((h) => Math.min(3, h + 1))} disabled={hintLevel >= 3}>💡 分级提示（{hintLevel}/3）</button>
                <button className="btn btn-lg" onClick={() => bigGo(1)} disabled={bigIdx >= bigPool.length - 1}>下一条 →</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={drawRandom} disabled={randomExhausted}>
                  🎲 随机抽谜（剩 {randomRemaining.length}）
                </button>
                <button className="btn btn-lg" onClick={() => setHintLevel((h) => Math.min(3, h + 1))} disabled={hintLevel >= 3}>💡 分级提示（{hintLevel}/3）</button>
              </>
            )}
            <button className="btn btn-lg" onClick={newBatch}>🔄 换一批</button>
            <button className="btn btn-ghost btn-lg" onClick={closeBig}>退出大屏</button>
          </div>
          <p className="bigscreen-count no-print">
            {bigMode === 'seq'
              ? `${bigIdx + 1} / ${bigPool.length} · 顺序放映`
              : `已抽 ${bigDrawn.length} / ${bigPool.length} · 随机抽取`}
            {' · 第 '}{bigRiddle.no} 号 · {filterDesc}
          </p>
        </div>
      )}
    </div>
  );
}
