import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Settings, 
  History as HistoryIcon, 
  Play, 
  Square, 
  Mic, 
  Trash2, 
  Upload,
  FileAudio,
  Zap,
  Target,
  Waves,
  Vibrate
} from 'lucide-react';
import { AudioEngine } from './services/audioEngine';
import Visualizer from './components/Visualizer';
import { DetectionRecord, AppSettings, AudioFrame } from './types';

const MAX_CHART_POINTS = 60;

const App: React.FC = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecordingReference, setIsRecordingReference] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('audio_pulse_settings');
    return saved ? JSON.parse(saved) : {
      threshold: 0.20,
      haWebhookUrl: '',
      cooldownSeconds: 1.5,
      referenceFingerprint: null
    };
  });
  
  const [history, setHistory] = useState<DetectionRecord[]>(() => {
    const saved = localStorage.getItem('audio_pulse_history');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [chartData, setChartData] = useState<AudioFrame[]>([]);
  const [currentDistance, setCurrentDistance] = useState(1.0);
  const [micLevel, setMicLevel] = useState(0);
  const [lastDetectionTime, setLastDetectionTime] = useState(0);
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'settings'>('monitor');

  const audioEngineRef = useRef<AudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 屏幕常亮控制 (Android 关键)
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
      } catch (err) {
        console.warn('WakeLock failed', err);
      }
    }
  };

  useEffect(() => {
    localStorage.setItem('audio_pulse_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('audio_pulse_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    let animationId: number;
    const tick = () => {
      if (!audioEngineRef.current || !isMonitoring) return;

      const freqData = audioEngineRef.current.getFrequencyData();
      if (freqData.length === 0) {
        animationId = requestAnimationFrame(tick);
        return;
      }

      // 计算实时音量
      const sum = freqData.reduce((a, b) => a + (b + 100), 0);
      setMicLevel(Math.min(1, (sum / freqData.length) / 80));

      const currentFingerprint = audioEngineRef.current.getFingerprint(freqData);
      let distance = 1.0; 
      if (settings.referenceFingerprint) {
        distance = audioEngineRef.current.compare(settings.referenceFingerprint, currentFingerprint);
      }

      setCurrentDistance(distance);
      
      setChartData(prev => {
        const newData = [...prev, { 
          time: new Date().toLocaleTimeString([], { hour12: false, minute:'2-digit', second:'2-digit' }), 
          distance, 
          threshold: settings.threshold 
        }];
        return newData.slice(-MAX_CHART_POINTS);
      });

      const now = Date.now();
      if (distance <= settings.threshold && (now - lastDetectionTime) > settings.cooldownSeconds * 1000) {
        handleDetection(distance);
        setLastDetectionTime(now);
      }

      animationId = requestAnimationFrame(tick);
    };

    if (isMonitoring) {
      animationId = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(animationId);
  }, [isMonitoring, settings.referenceFingerprint, settings.threshold, lastDetectionTime]);

  const handleDetection = (distance: number) => {
    const newRecord: DetectionRecord = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      distance,
      threshold: settings.threshold
    };
    
    setHistory(prev => [newRecord, ...prev].slice(0, 1000));
    
    // 安卓振动反馈
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  };

  const toggleMonitoring = async () => {
    try {
      if (isMonitoring) {
        setIsMonitoring(false);
        await toggleWakeLock(false);
      } else {
        if (!audioEngineRef.current) {
          audioEngineRef.current = new AudioEngine();
          await audioEngineRef.current.init();
        }
        setIsMonitoring(true);
        await toggleWakeLock(true);
      }
    } catch (err) {
      alert("麦克风启动失败，请检查权限设置。");
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-950 text-slate-100 overflow-hidden shadow-2xl">
      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-slate-800/50 bg-slate-900/80 backdrop-blur-xl z-20">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${isMonitoring ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>
            <Activity className={`w-5 h-5 ${isMonitoring ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight leading-none">声音统计器</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
              {isMonitoring ? '实时分析中' : '就绪'}
            </p>
          </div>
        </div>
        <button 
          onClick={toggleMonitoring}
          className={`px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest transition-all active:scale-90 shadow-lg ${
            isMonitoring 
              ? 'bg-red-500/10 text-red-500 border border-red-500/20' 
              : 'bg-blue-600 text-white shadow-blue-600/20'
          }`}
        >
          {isMonitoring ? '停止分析' : '开始分析'}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-6 pb-28">
        
        {activeTab === 'monitor' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* 核心统计卡片 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col items-center justify-center">
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-2">匹配总次数</span>
                <span className="text-5xl font-mono font-black text-blue-400 tabular-nums">{history.length}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col items-center justify-center">
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-2">当前相似度</span>
                <span className="text-4xl font-mono font-black text-slate-200">
                  {settings.referenceFingerprint ? `${(100 - currentDistance * 100).toFixed(0)}%` : '--'}
                </span>
              </div>
            </div>

            {/* 实时分析区域 */}
            <section className={`p-6 rounded-[2.5rem] border transition-all duration-300 ${currentDistance <= settings.threshold ? 'bg-blue-600/10 border-blue-500/50 ring-4 ring-blue-500/10' : 'bg-slate-900/30 border-slate-800'}`}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Waves className="w-4 h-4 text-blue-500" /> 分析图谱
                </h3>
                {wakeLock && (
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">屏幕已常亮</span>
                )}
              </div>
              
              <Visualizer data={chartData} threshold={settings.threshold} />
              
              <div className="mt-6 space-y-3">
                <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase">
                  <span>环境音量</span>
                  <span>{Math.round(micLevel * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div className="h-full bg-slate-600 transition-all" style={{ width: `${micLevel * 100}%` }} />
                </div>
              </div>
            </section>

            {!settings.referenceFingerprint && (
              <div className="p-6 bg-blue-600/10 border border-blue-500/20 rounded-3xl flex items-center gap-4">
                <Target className="w-10 h-10 text-blue-500 shrink-0" />
                <div>
                  <p className="text-blue-200 text-sm font-black">未设定样本声音</p>
                  <p className="text-blue-200/60 text-xs">请前往“配置录入”页面录制一段需要统计的特征声音。</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-black">统计记录</h2>
              <button onClick={() => setHistory([])} className="text-xs text-red-500 font-bold flex items-center gap-1 opacity-60 hover:opacity-100">
                <Trash2 className="w-3.5 h-3.5" /> 清空
              </button>
            </div>
            
            {history.length === 0 ? (
              <div className="py-20 text-center opacity-20">
                <HistoryIcon className="w-16 h-16 mx-auto mb-4" />
                <p className="font-bold text-sm tracking-widest uppercase">暂无匹配记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item, idx) => (
                  <div key={item.id} className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400 font-mono text-xs font-black">
                        #{history.length - idx}
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-300">触发成功</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-mono font-black text-blue-400">{(100 - item.distance * 100).toFixed(0)}%</span>
                      <p className="text-[9px] text-slate-600 font-bold uppercase">置信度</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
            <section className="bg-slate-900/50 rounded-[2.5rem] border border-slate-800 p-6 space-y-6">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Mic className="w-4 h-4" /> 样本录入
              </h3>
              
              <div className="flex flex-col items-center py-4">
                <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all ${isRecordingReference ? 'border-red-500 bg-red-500/10 scale-110 animate-pulse' : 'border-slate-800 bg-slate-950'}`}>
                  <Mic className={`w-8 h-8 ${isRecordingReference ? 'text-red-500' : 'text-slate-600'}`} />
                </div>
                <p className="mt-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {isRecordingReference ? '录制中...' : '等待录音'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={async () => {
                    if (!audioEngineRef.current) {
                      audioEngineRef.current = new AudioEngine();
                      await audioEngineRef.current.init();
                    }
                    setIsRecordingReference(true);
                    setTimeout(() => {
                      const freqData = audioEngineRef.current!.getFrequencyData();
                      const fp = audioEngineRef.current!.getFingerprint(freqData);
                      setSettings({...settings, referenceFingerprint: fp});
                      setIsRecordingReference(false);
                      if (navigator.vibrate) navigator.vibrate(200);
                    }, 1500);
                  }}
                  disabled={isRecordingReference}
                  className="bg-blue-600 text-white py-4 rounded-3xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-blue-600/20"
                >
                  点击录音
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-slate-800 text-slate-300 py-4 rounded-3xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all border border-slate-700"
                >
                  上传文件
                </button>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" accept="audio/*" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const buffer = await file.arrayBuffer();
                const engine = new AudioEngine();
                const fp = await engine.getFingerprintFromBuffer(buffer);
                setSettings({...settings, referenceFingerprint: fp});
                alert("样本解析成功！");
              }} />
            </section>

            <section className="bg-slate-900/50 rounded-[2.5rem] border border-slate-800 p-8 space-y-8">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Settings className="w-4 h-4" /> 分析参数
              </h3>
              
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">触发阈值 (数值越低越灵敏)</label>
                  <span className="text-xl font-mono font-black text-blue-400">{(settings.threshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0.05" max="0.5" step="0.01" 
                  value={settings.threshold} 
                  onChange={(e) => setSettings({...settings, threshold: parseFloat(e.target.value)})}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">匹配冷却 (秒)</label>
                  <span className="text-xl font-mono font-black text-blue-400">{settings.cooldownSeconds}s</span>
                </div>
                <input 
                  type="range" min="0.5" max="10" step="0.5" 
                  value={settings.cooldownSeconds} 
                  onChange={(e) => setSettings({...settings, cooldownSeconds: parseFloat(e.target.value)})}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/90 backdrop-blur-2xl border-t border-slate-800/50 py-4 px-6 flex justify-between items-center z-30 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <NavButton active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon={<Activity />} label="实时" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<HistoryIcon />} label="统计" />
        <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings />} label="配置" />
      </nav>
    </div>
  );
};

const NavButton = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-blue-500' : 'text-slate-600'}`}>
    <div className={`p-2 rounded-xl transition-all ${active ? 'bg-blue-500/10' : ''}`}>
      {React.cloneElement(icon, { size: 22, strokeWidth: active ? 3 : 2 })}
    </div>
    <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
  </button>
);

export default App;