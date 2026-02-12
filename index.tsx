import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  ChevronRight,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceLine,
  ComposedChart,
  Line
} from 'recharts';

// --- Types ---
interface DetectionRecord {
  id: string;
  timestamp: number;
  distance: number;
}

interface AppSettings {
  threshold: number;
  cooldownSeconds: number;
  referenceFingerprint: number[] | null;
}

interface AudioFrame {
  time: string;
  distance: number;
  threshold: number;
}

// --- Audio Engine ---
class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private fftSize: number = 4096;

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { 
        echoCancellation: false, 
        noiseSuppression: false, 
        autoGainControl: false 
      } 
    });
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const microphone = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.2;
    microphone.connect(this.analyser);
  }

  getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  getFingerprint(data: Float32Array): number[] {
    const bands = 64;
    const fingerprint = new Array(bands).fill(0);
    const step = Math.floor(data.length / bands);
    
    for (let i = 0; i < bands; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        const val = data[i * step + j];
        sum += Math.pow(10, (val + 100) / 20); // Convert dB to linear energy
      }
      fingerprint[i] = sum / step;
    }

    const magnitude = Math.sqrt(fingerprint.reduce((acc, v) => acc + v * v, 0)) || 1;
    return fingerprint.map(v => v / magnitude);
  }

  compare(f1: number[], f2: number[]): number {
    if (f1.length !== f2.length) return 1.0;
    let dotProduct = 0;
    for (let i = 0; i < f1.length; i++) {
      dotProduct += f1[i] * f2[i];
    }
    return 1 - Math.max(0, Math.min(1, dotProduct));
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
  }
}

// --- Components ---
const Visualizer: React.FC<{ data: AudioFrame[], threshold: number }> = ({ data, threshold }) => (
  <div className="w-full h-48 bg-slate-900/50 rounded-2xl border border-slate-800 overflow-hidden relative">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <YAxis domain={[0, 1]} hide />
        <Tooltip 
          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #3b82f6', borderRadius: '12px', fontSize: '10px' }}
          labelStyle={{ display: 'none' }}
        />
        <ReferenceLine y={threshold} stroke="#ef4444" strokeDasharray="3 3" />
        <Area type="monotone" dataKey="distance" stroke="#3b82f6" fillOpacity={1} fill="url(#colorDist)" isAnimationActive={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
    <div className="absolute top-2 right-4 text-[10px] font-bold text-red-400 uppercase tracking-widest pointer-events-none">
      阈值: {(threshold * 100).toFixed(0)}%
    </div>
  </div>
);

const App: React.FC = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecordingSample, setIsRecordingSample] = useState(false);
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'settings'>('monitor');
  const [history, setHistory] = useState<DetectionRecord[]>(() => {
    const saved = localStorage.getItem('audio_pulse_history_v2');
    return saved ? JSON.parse(saved) : [];
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('audio_pulse_settings_v2');
    return saved ? JSON.parse(saved) : { threshold: 0.15, cooldownSeconds: 1.2, referenceFingerprint: null };
  });

  const [chartData, setChartData] = useState<AudioFrame[]>([]);
  const [currentDistance, setCurrentDistance] = useState(1.0);
  const [micLevel, setMicLevel] = useState(0);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [lastMatchTime, setLastMatchTime] = useState(0);

  const audioEngineRef = useRef<AudioEngine | null>(null);

  // Persistence
  useEffect(() => localStorage.setItem('audio_pulse_settings_v2', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('audio_pulse_history_v2', JSON.stringify(history)), [history]);

  // Wake Lock for Android
  const toggleWakeLock = async (on: boolean) => {
    if ('wakeLock' in navigator) {
      try {
        if (on && !wakeLock) {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
        } else if (!on && wakeLock) {
          await wakeLock.release();
          setWakeLock(null);
        }
      } catch (e) { console.warn('WakeLock err', e); }
    }
  };

  // Main Loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      if (!audioEngineRef.current || !isMonitoring) return;
      
      const freqData = audioEngineRef.current.getFrequencyData();
      if (freqData.length === 0) {
        animId = requestAnimationFrame(loop);
        return;
      }

      // Mic level for UI feedback
      const avg = freqData.reduce((a, b) => a + (b + 100), 0) / freqData.length;
      setMicLevel(Math.min(1, avg / 80));

      const fp = audioEngineRef.current.getFingerprint(freqData);
      let dist = 1.0;
      if (settings.referenceFingerprint) {
        dist = audioEngineRef.current.compare(settings.referenceFingerprint, fp);
      }
      
      setCurrentDistance(dist);
      setChartData(prev => [...prev.slice(-49), { 
        time: new Date().toLocaleTimeString(), 
        distance: dist, 
        threshold: settings.threshold 
      }]);

      const now = Date.now();
      if (dist <= settings.threshold && (now - lastMatchTime) > settings.cooldownSeconds * 1000) {
        const record = { id: Math.random().toString(36).substr(2, 9), timestamp: now, distance: dist };
        setHistory(prev => [record, ...prev].slice(0, 500));
        setLastMatchTime(now);
        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      }

      animId = requestAnimationFrame(loop);
    };

    if (isMonitoring) animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isMonitoring, settings.referenceFingerprint, settings.threshold, settings.cooldownSeconds, lastMatchTime]);

  const toggleApp = async () => {
    if (isMonitoring) {
      setIsMonitoring(false);
      toggleWakeLock(false);
    } else {
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
        await audioEngineRef.current.init();
      }
      setIsMonitoring(true);
      toggleWakeLock(true);
    }
  };

  const recordSample = async () => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new AudioEngine();
      await audioEngineRef.current.init();
    }
    setIsRecordingSample(true);
    setTimeout(() => {
      const data = audioEngineRef.current!.getFrequencyData();
      const fp = audioEngineRef.current!.getFingerprint(data);
      setSettings(s => ({ ...s, referenceFingerprint: fp }));
      setIsRecordingSample(false);
      if (navigator.vibrate) navigator.vibrate(200);
    }, 1200);
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-950 text-slate-100 overflow-hidden relative">
      {/* Background Glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[50%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none z-0" />
      
      {/* Header */}
      <header className="p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-2xl ${isMonitoring ? 'bg-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'bg-slate-800'}`}>
            <Activity className={`w-6 h-6 ${isMonitoring ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">AudioPulse</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
              {isMonitoring ? '正在实时分析' : '分析引擎就绪'}
            </p>
          </div>
        </div>
        <button 
          onClick={toggleApp}
          className={`px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest transition-all active:scale-90 ${
            isMonitoring ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-blue-600 text-white shadow-xl shadow-blue-900/40'
          }`}
        >
          {isMonitoring ? '停止' : '开始'}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto no-scrollbar px-6 space-y-6 pb-32 z-10">
        {activeTab === 'monitor' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Big Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-[2.5rem] p-8 flex flex-col items-center justify-center">
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">匹配次数</span>
                <span className="text-6xl font-mono font-black text-blue-400">{history.length}</span>
              </div>
              <div className="glass rounded-[2.5rem] p-8 flex flex-col items-center justify-center">
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">相似度</span>
                <span className="text-4xl font-mono font-black text-slate-200">
                  {settings.referenceFingerprint ? `${(100 - currentDistance * 100).toFixed(0)}%` : '--'}
                </span>
              </div>
            </div>

            {/* Visualizer Card */}
            <div className="glass rounded-[2.5rem] p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-blue-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">实时特征指纹距离</span>
                </div>
                {wakeLock && <span className="text-[8px] font-black bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">屏幕常亮</span>}
              </div>
              <Visualizer data={chartData} threshold={settings.threshold} />
              <div className="flex items-center gap-3">
                <Mic className="w-3.5 h-3.5 text-slate-500" />
                <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-75" style={{ width: `${micLevel * 100}%` }} />
                </div>
              </div>
            </div>

            {/* Quick Action Info */}
            {!settings.referenceFingerprint && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-6 flex items-start gap-4">
                <div className="p-3 bg-blue-500/20 rounded-2xl">
                  <Target className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <h4 className="font-black text-sm text-blue-100">未设置参考样本</h4>
                  <p className="text-xs text-blue-300/60 leading-relaxed mt-1">请点击右下角“配置”图标，录制一段您想要统计的特定声音样本。</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black italic tracking-tighter uppercase">记录回放</h2>
              <button onClick={() => setHistory([])} className="p-2 text-slate-600 hover:text-red-500 transition-colors">
                <Trash2 size={20} />
              </button>
            </div>
            {history.length === 0 ? (
              <div className="py-20 flex flex-col items-center opacity-20">
                <History size={64} className="mb-4" />
                <span className="text-xs font-black uppercase tracking-widest">暂无统计数据</span>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((h, i) => (
                  <div key={h.id} className="glass p-4 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-[10px] font-black text-blue-400">
                        #{history.length - i}
                      </div>
                      <div>
                        <div className="text-sm font-bold tracking-tight">成功匹配声音</div>
                        <div className="text-[10px] font-mono text-slate-500 uppercase">{new Date(h.timestamp).toLocaleTimeString()}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-blue-400">{(100 - h.distance * 100).toFixed(1)}%</div>
                      <div className="text-[8px] font-black text-slate-600 uppercase">相似度</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-8 animate-in slide-in-from-left-4 duration-300">
            {/* Record Section */}
            <section className="glass rounded-[2.5rem] p-8 space-y-6">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Target size={14} className="text-blue-400" /> 样本特征录入
              </h3>
              <div className="flex flex-col items-center">
                <button 
                  onClick={recordSample}
                  disabled={isRecordingSample}
                  className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all ${
                    isRecordingSample ? 'bg-red-500/20 scale-110 shadow-[0_0_40px_rgba(239,68,68,0.4)]' : 'bg-slate-900 border-2 border-slate-800'
                  }`}
                >
                  <Mic size={40} className={isRecordingSample ? 'text-red-500 animate-pulse' : 'text-slate-400'} />
                  {isRecordingSample && (
                    <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />
                  )}
                </button>
                <p className="mt-4 text-xs font-black uppercase text-slate-500">
                  {isRecordingSample ? '录制中...' : settings.referenceFingerprint ? '已更新参考样本' : '点击开始录制样本'}
                </p>
              </div>
            </section>

            {/* Params Section */}
            <section className="glass rounded-[2.5rem] p-8 space-y-8">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Settings size={14} className="text-blue-400" /> 分析引擎参数
              </h3>
              
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase">匹配灵敏度 (阈值)</label>
                  <span className="text-xl font-mono font-black text-blue-400">{(settings.threshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0.05" max="0.5" step="0.01" 
                  value={settings.threshold} 
                  onChange={e => setSettings(s => ({...s, threshold: parseFloat(e.target.value)}))}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase">统计冷却间隔 (秒)</label>
                  <span className="text-xl font-mono font-black text-blue-400">{settings.cooldownSeconds}s</span>
                </div>
                <input 
                  type="range" min="0.2" max="5" step="0.1" 
                  value={settings.cooldownSeconds} 
                  onChange={e => setSettings(s => ({...s, cooldownSeconds: parseFloat(e.target.value)}))}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none"
                />
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Nav */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/80 backdrop-blur-3xl border-t border-white/5 px-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-between items-center z-50">
        <NavBtn active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon={<Activity />} label="实时" />
        <NavBtn active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History />} label="统计" />
        <NavBtn active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings />} label="配置" />
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