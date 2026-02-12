
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
  Vibrate,
  ShieldCheck,
  AlertCircle,
  BarChart3
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  ReferenceLine,
  YAxis
} from 'recharts';

// --- 类型定义 ---
interface SoundMatch {
  id: string;
  time: number;
  confidence: number;
}

interface UserConfig {
  threshold: number;
  cooldown: number;
  fingerprint: number[] | null;
}

// --- 音频算法引擎 ---
class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
    });
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.25;
    source.connect(this.analyser);
  }

  getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  // 提取频谱指纹 (64 频段能量分布)
  extractFingerprint(data: Float32Array): number[] {
    const bands = 64;
    const fp = new Array(bands).fill(0);
    const step = Math.floor(data.length / bands);
    for (let i = 0; i < bands; i++) {
      let energy = 0;
      for (let j = 0; j < step; j++) {
        energy += Math.pow(10, (data[i * step + j] + 100) / 20);
      }
      fp[i] = energy / step;
    }
    // 向量归一化
    const mag = Math.sqrt(fp.reduce((a, b) => a + b * b, 0)) || 1;
    return fp.map(v => v / mag);
  }

  // 计算余弦相似度
  compare(f1: number[], f2: number[]): number {
    let dot = 0;
    for (let i = 0; i < f1.length; i++) dot += f1[i] * f2[i];
    return Math.max(0, Math.min(1, dot));
  }

  close() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
  }
}

// --- 主组件 ---
const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'setup'>('monitor');
  const [isLive, setIsLive] = useState(false);
  const [isSampling, setIsSampling] = useState(false);
  const [simValue, setSimValue] = useState(0);
  const [history, setHistory] = useState<SoundMatch[]>(() => {
    const saved = localStorage.getItem('audio_pulse_history_v4');
    return saved ? JSON.parse(saved) : [];
  });
  const [config, setConfig] = useState<UserConfig>(() => {
    const saved = localStorage.getItem('audio_pulse_config_v4');
    return saved ? JSON.parse(saved) : { threshold: 0.88, cooldown: 1.0, fingerprint: null };
  });

  const [chartData, setChartData] = useState<{ v: number }[]>([]);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [lastMatchAt, setLastMatchAt] = useState(0);
  const [isHighlighting, setIsHighlighting] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);

  // 数据持久化
  useEffect(() => localStorage.setItem('audio_pulse_history_v4', JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem('audio_pulse_config_v4', JSON.stringify(config)), [config]);

  // 安卓屏幕常亮申请
  const requestWakeLock = async (on: boolean) => {
    if ('wakeLock' in navigator) {
      try {
        if (on && !wakeLock) {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
        } else if (!on && wakeLock) {
          await wakeLock.release();
          setWakeLock(null);
        }
      } catch (err) { console.warn('WakeLock failed', err); }
    }
  };

  // 监听逻辑
  useEffect(() => {
    let anim: number;
    const process = () => {
      if (!engineRef.current || !isLive) return;
      const data = engineRef.current.getFrequencyData();
      if (data.length === 0) { anim = requestAnimationFrame(process); return; }

      const currentFp = engineRef.current.extractFingerprint(data);
      let sim = 0;
      if (config.fingerprint) {
        sim = engineRef.current.compare(config.fingerprint, currentFp);
      }

      setSimValue(sim);
      setChartData(prev => [...prev.slice(-39), { v: sim }]);

      const now = Date.now();
      if (sim >= config.threshold && (now - lastMatchAt) > config.cooldown * 1000) {
        handleMatch(sim);
        setLastMatchAt(now);
      }

      anim = requestAnimationFrame(process);
    };

    if (isLive) anim = requestAnimationFrame(process);
    return () => cancelAnimationFrame(anim);
  }, [isLive, config, lastMatchAt]);

  const handleMatch = (sim: number) => {
    const record = { id: Math.random().toString(36).substr(2, 9), time: Date.now(), confidence: sim };
    setHistory(prev => [record, ...prev].slice(0, 500));
    
    // UI 反馈
    setIsHighlighting(true);
    setTimeout(() => setIsHighlighting(false), 500);
    
    // 安卓物理反馈
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  };

  const toggleMonitor = async () => {
    if (isLive) {
      setIsLive(false);
      requestWakeLock(false);
    } else {
      if (!engineRef.current) {
        engineRef.current = new AudioEngine();
        await engineRef.current.init();
      }
      setIsLive(true);
      requestWakeLock(true);
    }
  };

  const captureSample = async () => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
      await engineRef.current.init();
    }
    setIsSampling(true);
    // 延迟 1.2 秒进行采样，给用户发出声音的时间
    setTimeout(() => {
      const data = engineRef.current!.getFrequencyData();
      // Fix: Used extractFingerprint instead of getFingerprint to match AudioEngine class definition
      const fp = engineRef.current!.extractFingerprint(data);
      setConfig(prev => ({ ...prev, fingerprint: fp }));
      setIsSampling(false);
      if (navigator.vibrate) navigator.vibrate(200);
    }, 1200);
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto relative select-none">
      {/* 顶部状态 */}
      <header className="p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-2xl transition-all ${isLive ? 'bg-blue-500/20 shadow-lg shadow-blue-500/20' : 'bg-slate-800'}`}>
            <Activity className={`w-6 h-6 ${isLive ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter leading-none">声音统计器</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">AudioPulse AI Pro</p>
          </div>
        </div>
        <button 
          onClick={toggleMonitor}
          className={`px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest transition-all active:scale-90 ${
            isLive ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-blue-600 text-white shadow-xl shadow-blue-900/40'
          }`}
        >
          {isLive ? '停止' : '开始'}
        </button>
      </header>

      {/* 主视图 */}
      <main className="flex-1 overflow-y-auto no-scrollbar px-6 space-y-6 pb-28 z-10">
        
        {activeTab === 'monitor' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* 核心统计：大数字 */}
            <div className={`glass-card rounded-[3rem] p-12 flex flex-col items-center justify-center transition-all ${isHighlighting ? 'animate-hit border-blue-500/50' : ''}`}>
              <span className="text-[11px] text-slate-500 font-black uppercase tracking-[0.2em] mb-2">匹配次数计数</span>
              <div className="flex items-baseline gap-2">
                <span className="text-9xl font-mono font-black text-blue-400 drop-shadow-[0_0_20px_rgba(59,130,246,0.5)]">
                  {history.length}
                </span>
                <span className="text-xl font-black text-slate-600">次</span>
              </div>
            </div>

            {/* 指纹相似度图表 */}
            <div className="glass-card rounded-[2.5rem] p-6 space-y-4">
              <div className="flex justify-between items-center px-2">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-blue-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">实时匹配率</span>
                </div>
                <div className="flex items-center gap-3">
                  {wakeLock && <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />}
                  <span className="text-sm font-mono font-black text-blue-400">{(simValue * 100).toFixed(0)}%</span>
                </div>
              </div>
              
              <div className="h-32 w-full rounded-2xl bg-slate-900/50 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <YAxis domain={[0, 1]} hide />
                    <ReferenceLine y={config.threshold} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={2} />
                    <Area 
                      type="stepAfter" 
                      dataKey="v" 
                      stroke="#3b82f6" 
                      fill="url(#simGrad)" 
                      isAnimationActive={false} 
                      strokeWidth={3} 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {!config.fingerprint && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-3xl p-6 flex items-start gap-4">
                <AlertCircle className="w-8 h-8 text-amber-500 shrink-0" />
                <p className="text-xs text-amber-200 font-bold leading-relaxed">
                  请先录制一个样本指纹。前往 <span className="text-amber-500 underline decoration-2">配置</span> 页面，录制需要统计的特定声音。
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-black italic uppercase tracking-tighter">历史记录</h2>
              <button 
                onClick={() => confirm('确定清空所有记录吗？') && setHistory([])}
                className="p-3 text-slate-600 active:text-red-500 transition-colors"
              >
                <Trash2 size={20} />
              </button>
            </div>
            {history.length === 0 ? (
              <div className="py-24 flex flex-col items-center opacity-20">
                <History size={64} className="mb-4" strokeWidth={1} />
                <span className="text-[10px] font-black uppercase tracking-widest">暂无记录数据</span>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((h, i) => (
                  <div key={h.id} className="glass-card p-4 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-xs font-mono font-black text-blue-400">
                        #{history.length - i}
                      </div>
                      <div>
                        <div className="text-sm font-bold">成功匹配</div>
                        <div className="text-[10px] font-mono text-slate-500 uppercase">
                          {new Date(h.time).toLocaleString('zh-CN', { hour12: false })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-blue-400">{(h.confidence * 100).toFixed(1)}%</div>
                      <div className="text-[8px] font-black text-slate-600 uppercase">相似度</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="space-y-8 animate-in slide-in-from-left-4 duration-300">
            {/* 指纹采集 */}
            <section className="glass-card rounded-[2.5rem] p-8 space-y-6">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Target size={14} className="text-blue-400" /> 特征样本录入
              </h3>
              <div className="flex flex-col items-center">
                <button 
                  onClick={captureSample}
                  disabled={isSampling}
                  className={`relative w-36 h-36 rounded-full flex items-center justify-center transition-all ${
                    isSampling ? 'bg-red-500/20 scale-110 shadow-[0_0_40px_rgba(239,68,68,0.4)]' : 'bg-slate-900 border-2 border-slate-800 active:scale-95'
                  }`}
                >
                  <Mic size={48} className={isSampling ? 'text-red-500 animate-pulse' : 'text-slate-500'} />
                  {isSampling && (
                    <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />
                  )}
                </button>
                <div className="mt-6 text-center">
                  <p className="text-xs font-black uppercase text-slate-400">
                    {isSampling ? '正在采样特征...' : config.fingerprint ? '指纹已就绪' : '等待录音样本'}
                  </p>
                  <p className="text-[9px] text-slate-600 mt-2 max-w-[200px] leading-relaxed">
                    点击按钮后发出您要统计的声音（约1.2秒），算法将提取特征指纹。
                  </p>
                </div>
              </div>
            </section>

            {/* 灵敏度调整 */}
            <section className="glass-card rounded-[2.5rem] p-8 space-y-8">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <BarChart3 size={14} className="text-blue-400" /> 灵敏度控制
              </h3>
              
              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">相似度阈值</label>
                  <span className="text-xl font-mono font-black text-blue-400">{(config.threshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0.5" max="0.99" step="0.01" 
                  value={config.threshold} 
                  onChange={e => setConfig(prev => ({ ...prev, threshold: parseFloat(e.target.value) }))}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-full appearance-none"
                />
                <p className="text-[9px] text-slate-600 leading-relaxed">越高要求声音越接近样本。若背景嘈杂请适当调高。</p>
              </div>

              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">触发冷却 (秒)</label>
                  <span className="text-xl font-mono font-black text-blue-400">{config.cooldown}s</span>
                </div>
                <input 
                  type="range" min="0.1" max="5.0" step="0.1" 
                  value={config.cooldown} 
                  onChange={e => setConfig(prev => ({ ...prev, cooldown: parseFloat(e.target.value) }))}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-full appearance-none"
                />
                <p className="text-[9px] text-slate-600 leading-relaxed">匹配成功后，暂停监听的时间段，防止连发误统。</p>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* 底部导航 */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-950/80 backdrop-blur-3xl border-t border-white/5 px-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-between items-center z-50">
        <NavBtn active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon={<Activity />} label="实时统计" />
        <NavBtn active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History />} label="历史明细" />
        <NavBtn active={activeTab === 'setup'} onClick={() => setActiveTab('setup')} icon={<Settings />} label="采样配置" />
      </nav>
    </div>
  );
};

const NavBtn = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1.5 transition-all ${active ? 'text-blue-500 scale-105' : 'text-slate-600'}`}>
    <div className={`p-2 rounded-2xl transition-all ${active ? 'bg-blue-500/15' : ''}`}>
      {React.cloneElement(icon, { size: 22, strokeWidth: active ? 3 : 2 })}
    </div>
    <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
  </button>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
