import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  Activity, 
  Mic, 
  Settings, 
  History, 
  Trash2, 
  Target, 
  Waves, 
  Bell,
  CheckCircle2,
  AlertTriangle,
  Zap
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  ReferenceLine,
  YAxis,
  Tooltip
} from 'recharts';

// --- 类型定义 ---
interface DetectionRecord {
  id: string;
  timestamp: number;
  similarity: number;
}

interface AppSettings {
  threshold: number;
  cooldown: number;
  referenceFp: number[] | null;
}

// --- 音频分析引擎 ---
class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
    });
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.2;
    source.connect(this.analyser);
  }

  getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  getFingerprint(data: Float32Array): number[] {
    const bands = 64;
    const fp = new Array(bands).fill(0);
    const step = Math.floor(data.length / bands);
    for (let i = 0; i < bands; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += Math.pow(10, (data[i * step + j] + 100) / 20);
      }
      fp[i] = sum / step;
    }
    const mag = Math.sqrt(fp.reduce((a, b) => a + b * b, 0)) || 1;
    return fp.map(v => v / mag);
  }

  compare(f1: number[], f2: number[]): number {
    let dot = 0;
    for (let i = 0; i < f1.length; i++) dot += f1[i] * f2[i];
    return Math.max(0, Math.min(1, dot));
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
  }
}

// --- 主应用组件 ---
const App: React.FC = () => {
  const [tab, setTab] = useState<'realtime' | 'history' | 'setup'>('realtime');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentSimilarity, setCurrentSimilarity] = useState(0);
  const [history, setHistory] = useState<DetectionRecord[]>(() => {
    const saved = localStorage.getItem('audio_history_v3');
    return saved ? JSON.parse(saved) : [];
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('audio_settings_v3');
    return saved ? JSON.parse(saved) : { threshold: 0.85, cooldown: 1.2, referenceFp: null };
  });

  const [chartData, setChartData] = useState<{ time: string; sim: number }[]>([]);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [lastMatchTime, setLastMatchTime] = useState(0);
  const [justMatched, setJustMatched] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);

  // 持久化存储
  useEffect(() => localStorage.setItem('audio_history_v3', JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem('audio_settings_v3', JSON.stringify(settings)), [settings]);

  // 安卓屏幕常亮逻辑
  const toggleWakeLock = async (enable: boolean) => {
    if ('wakeLock' in navigator) {
      try {
        if (enable && !wakeLock) {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
        } else if (!enable && wakeLock) {
          await wakeLock.release();
          setWakeLock(null);
        }
      } catch (e) { console.warn('WakeLock失败', e); }
    }
  };

  // 核心监听循环
  useEffect(() => {
    let animId: number;
    const loop = () => {
      if (!engineRef.current || !isMonitoring) return;
      const data = engineRef.current.getFrequencyData();
      if (data.length === 0) { animId = requestAnimationFrame(loop); return; }

      const fp = engineRef.current.getFingerprint(data);
      let sim = 0;
      if (settings.referenceFp) {
        sim = engineRef.current.compare(settings.referenceFp, fp);
      }

      setCurrentSimilarity(sim);
      setChartData(prev => [...prev.slice(-49), { time: '', sim }]);

      const now = Date.now();
      if (sim >= settings.threshold && (now - lastMatchTime) > settings.cooldown * 1000) {
        triggerMatch(sim);
        setLastMatchTime(now);
      }

      animId = requestAnimationFrame(loop);
    };

    if (isMonitoring) animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isMonitoring, settings]);

  const triggerMatch = (sim: number) => {
    const newRecord = { id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), similarity: sim };
    setHistory(prev => [newRecord, ...prev].slice(0, 1000));
    setMatchCount(c => c + 1);
    setJustMatched(true);
    setTimeout(() => setJustMatched(false), 800);
    
    // 安卓触感反馈
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  };

  const toggleMonitor = async () => {
    if (isMonitoring) {
      setIsMonitoring(false);
      toggleWakeLock(false);
    } else {
      if (!engineRef.current) {
        engineRef.current = new AudioEngine();
        await engineRef.current.start();
      }
      setIsMonitoring(true);
      toggleWakeLock(true);
    }
  };

  const recordSample = async () => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
      await engineRef.current.start();
    }
    setIsRecording(true);
    setTimeout(() => {
      const data = engineRef.current!.getFrequencyData();
      const fp = engineRef.current!.getFingerprint(data);
      setSettings(s => ({ ...s, referenceFp: fp }));
      setIsRecording(false);
      if (navigator.vibrate) navigator.vibrate(300);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto relative overflow-hidden">
      {/* 背景动态装饰 */}
      <div className={`absolute -top-20 -left-20 w-64 h-64 rounded-full blur-[100px] transition-colors duration-1000 ${isMonitoring ? 'bg-blue-600/20' : 'bg-slate-800/10'}`} />
      
      {/* 顶部状态栏 */}
      <header className="p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-2xl transition-all ${isMonitoring ? 'bg-blue-500/20 shadow-lg shadow-blue-500/20' : 'bg-slate-800'}`}>
            <Activity className={`w-6 h-6 ${isMonitoring ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight leading-none">声音统计器</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">AudioPulse AI v3</p>
          </div>
        </div>
        <button 
          onClick={toggleMonitor}
          className={`px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest transition-all active:scale-90 ${
            isMonitoring ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-blue-600 text-white shadow-xl shadow-blue-900/40'
          }`}
        >
          {isMonitoring ? '停止监听' : '开始监听'}
        </button>
      </header>

      {/* 主体内容区域 */}
      <main className="flex-1 overflow-y-auto no-scrollbar px-6 space-y-6 pb-28 z-10">
        
        {tab === 'realtime' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* 核心计数卡片 */}
            <div className={`glass-card rounded-[2.5rem] p-10 flex flex-col items-center justify-center transition-all ${justMatched ? 'match-pulse scale-105 border-blue-500/50' : ''}`}>
              <span className="text-[11px] text-slate-500 font-black uppercase tracking-[0.2em] mb-2">已统计次数</span>
              <div className="flex items-baseline gap-1">
                <span className="text-8xl font-mono font-black text-blue-400 drop-shadow-2xl tracking-tighter">
                  {history.length}
                </span>
                <span className="text-xl font-black text-blue-500/40">次</span>
              </div>
            </div>

            {/* 实时分析视图 */}
            <div className="glass-card rounded-[2rem] p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-blue-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">相似度实时图表</span>
                </div>
                <div className="flex gap-2">
                  {wakeLock && <span className="text-[8px] font-black bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">屏幕常亮</span>}
                  <span className="text-xs font-mono font-black text-blue-400">{(currentSimilarity * 100).toFixed(0)}%</span>
                </div>
              </div>
              
              <div className="h-40 w-full overflow-hidden rounded-xl bg-slate-900/50">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="simGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <YAxis domain={[0, 1]} hide />
                    <ReferenceLine y={settings.threshold} stroke="#ef4444" strokeDasharray="3 3" />
                    <Area type="monotone" dataKey="sim" stroke="#3b82f6" fill="url(#simGradient)" isAnimationActive={false} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {!settings.referenceFp && (
              <div className="p-6 bg-blue-500/10 border border-blue-500/20 rounded-3xl flex items-center gap-4">
                <AlertTriangle className="w-8 h-8 text-blue-400 shrink-0" />
                <p className="text-xs text-blue-100 font-bold leading-relaxed">
                  检测到您尚未录制声音样本。请前往 <span className="text-blue-400">配置</span> 页面录入特征音。
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-4 animate-in slide-in-from-right-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-black italic tracking-tighter uppercase">统计记录</h2>
              <button 
                onClick={() => { if(confirm('确定清空所有记录吗？')) setHistory([]); }}
                className="p-2 text-slate-600 hover:text-red-500 transition-colors"
              >
                <Trash2 size={20} />
              </button>
            </div>
            {history.length === 0 ? (
              <div className="py-24 flex flex-col items-center opacity-20">
                <History size={64} strokeWidth={1} className="mb-4" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em]">暂无统计数据</span>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((h, i) => (
                  <div key={h.id} className="glass-card p-4 rounded-2xl flex items-center justify-between border-l-4 border-l-blue-500">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-xs font-black text-blue-400 font-mono">
                        #{history.length - i}
                      </div>
                      <div>
                        <div className="text-sm font-bold">匹配成功</div>
                        <div className="text-[10px] font-mono text-slate-500 uppercase">
                          {new Date(h.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-blue-400">{(h.similarity * 100).toFixed(1)}%</div>
                      <div className="text-[8px] font-black text-slate-600 uppercase">相似度</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'setup' && (
          <div className="space-y-8 animate-in slide-in-from-left-4">
            <section className="glass-card rounded-[2.5rem] p-8 space-y-6">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Target size={14} className="text-blue-400" /> 特征样本采集
              </h3>
              <div className="flex flex-col items-center py-4">
                <button 
                  onClick={recordSample}
                  disabled={isRecording}
                  className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                    isRecording ? 'bg-red-500/20 scale-110 shadow-[0_0_40px_rgba(239,68,68,0.3)]' : 'bg-slate-900 border-2 border-slate-800'
                  }`}
                >
                  <Mic size={40} className={isRecording ? 'text-red-500 animate-pulse' : 'text-slate-500'} />
                  {isRecording && (
                    <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />
                  )}
                </button>
                <div className="mt-6 text-center">
                  <p className="text-xs font-black uppercase text-slate-400">
                    {isRecording ? '正在监听采样...' : settings.referenceFp ? '已有样本：已就绪' : '等待首次录音'}
                  </p>
                  <p className="text-[9px] text-slate-600 mt-2 max-w-[180px] leading-relaxed">
                    点击按钮后发出您想要统计的声音（约1.5秒），引擎将提取频谱特征。
                  </p>
                </div>
              </div>
            </section>

            <section className="glass-card rounded-[2.5rem] p-8 space-y-8">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Settings size={14} className="text-blue-400" /> 引擎参数调整
              </h3>
              
              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">匹配阈值 (灵敏度)</label>
                  <span className="text-xl font-mono font-black text-blue-400">{(settings.threshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0.5" max="0.99" step="0.01" 
                  value={settings.threshold} 
                  onChange={e => setSettings(s => ({...s, threshold: parseFloat(e.target.value)}))}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none"
                />
                <p className="text-[9px] text-slate-600">数值越高要求越接近样本。通常 85% 是个好的开始。</p>
              </div>

              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">统计冷却时间</label>
                  <span className="text-xl font-mono font-black text-blue-400">{settings.cooldown}s</span>
                </div>
                <input 
                  type="range" min="0.2" max="5" step="0.1" 
                  value={settings.cooldown} 
                  onChange={e => setSettings(s => ({...s, cooldown: parseFloat(e.target.value)}))}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none"
                />
                <p className="text-[9px] text-slate-600">触发成功后暂停监听的时长，防止重复统计同一次声音。</p>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* 底部导航栏 */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-950/80 backdrop-blur-3xl border-t border-white/5 px-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-between items-center z-50">
        <NavBtn active={tab === 'realtime'} onClick={() => setTab('realtime')} icon={<Activity />} label="实时" />
        <NavBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History />} label="记录" />
        <NavBtn active={tab === 'setup'} onClick={() => setTab('setup')} icon={<Settings />} label="配置" />
      </nav>
    </div>
  );
};

const NavBtn = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1.5 transition-all ${active ? 'text-blue-500 scale-110' : 'text-slate-600'}`}>
    <div className={`p-2 rounded-2xl transition-all ${active ? 'bg-blue-500/15' : ''}`}>
      {React.cloneElement(icon, { size: 22, strokeWidth: active ? 3 : 2 })}
    </div>
    <span className="text-[9px] font-black uppercase tracking-[0.15em]">{label}</span>
  </button>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);