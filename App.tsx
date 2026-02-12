import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Settings, 
  History as HistoryIcon, 
  Play, 
  Square, 
  Mic, 
  Bell, 
  Trash2, 
  Home,
  CheckCircle2,
  Sun,
  Moon,
  Upload,
  FileAudio,
  XCircle,
  Zap,
  Target,
  Waves
} from 'lucide-react';
import { AudioEngine } from './services/audioEngine';
import { notifyHomeAssistant } from './services/haService';
import Visualizer from './components/Visualizer';
import { DetectionRecord, AppSettings, AudioFrame } from './types';

const MAX_CHART_POINTS = 50;

const App: React.FC = () => {
  // State
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecordingReference, setIsRecordingReference] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [wakeLockSupported, setWakeLockSupported] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('gaspulse_settings');
    return saved ? JSON.parse(saved) : {
      threshold: 0.25,
      haWebhookUrl: '',
      cooldownSeconds: 2.0,
      referenceFingerprint: null
    };
  });
  
  const [history, setHistory] = useState<DetectionRecord[]>(() => {
    const saved = localStorage.getItem('gaspulse_history');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [chartData, setChartData] = useState<AudioFrame[]>([]);
  const [currentDistance, setCurrentDistance] = useState(1.0);
  const [hoveredDistance, setHoveredDistance] = useState<number | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [lastDetectionTime, setLastDetectionTime] = useState(0);
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'settings'>('monitor');

  const displayDistance = (!isMonitoring && hoveredDistance !== null) ? hoveredDistance : currentDistance;
  const isHitActive = displayDistance <= settings.threshold && settings.referenceFingerprint !== null;

  const audioEngineRef = useRef<AudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        const lock = await (navigator as any).wakeLock.request('screen');
        setWakeLock(lock);
        setWakeLockSupported(true);
      } catch (err: any) {
        setWakeLockSupported(false);
      }
    } else {
      setWakeLockSupported(false);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLock) {
      wakeLock.release().then(() => setWakeLock(null)).catch(console.error);
    }
  };

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (isMonitoring && document.visibilityState === 'visible' && wakeLockSupported) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isMonitoring, wakeLockSupported]);

  useEffect(() => {
    localStorage.setItem('gaspulse_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('gaspulse_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    let animationId: number;

    const tick = () => {
      if (!audioEngineRef.current || (!isMonitoring && !isRecordingReference)) {
        animationId = requestAnimationFrame(tick);
        return;
      }

      const freqData = audioEngineRef.current.getFrequencyData();
      if (freqData.length === 0) {
        animationId = requestAnimationFrame(tick);
        return;
      }

      const sum = freqData.reduce((a, b) => a + Math.max(0, b + 100), 0);
      const avg = sum / freqData.length;
      const level = Math.min(1, avg / 70); 
      setMicLevel(level);

      const currentFingerprint = audioEngineRef.current.getFingerprint(freqData);

      let distance = 1.0; 
      if (settings.referenceFingerprint) {
        distance = audioEngineRef.current.compare(settings.referenceFingerprint, currentFingerprint);
      }

      if (isMonitoring) {
        setCurrentDistance(distance);
        
        setChartData(prev => {
          const newData = [...prev, { 
            time: new Date().toLocaleTimeString([], { hour12: false }), 
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
      }

      animationId = requestAnimationFrame(tick);
    };

    if (isMonitoring || isRecordingReference) {
      animationId = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(animationId);
  }, [isMonitoring, isRecordingReference, settings.referenceFingerprint, settings.threshold, settings.cooldownSeconds, lastDetectionTime]);

  const toggleMonitoring = async () => {
    if (isMonitoring) {
      setIsMonitoring(false);
      releaseWakeLock();
    } else {
      await startMonitoring();
      if (wakeLockSupported) {
        await requestWakeLock();
      }
    }
  };

  const startMonitoring = async () => {
    try {
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
        await audioEngineRef.current.init();
      }
      setIsMonitoring(true);
    } catch (err) {
      alert("请允许麦克风访问权限。");
    }
  };

  const handleDetection = (distance: number) => {
    const newRecord: DetectionRecord = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      distance,
      threshold: settings.threshold
    };
    
    setHistory(prev => [newRecord, ...prev].slice(0, 500));
    
    if (settings.haWebhookUrl) {
      notifyHomeAssistant(settings.haWebhookUrl, { distance });
    }

    if (navigator.vibrate) navigator.vibrate(150);
  };

  const clearHistory = () => {
    if (confirm("确定要清空统计次数吗？")) {
      setHistory([]);
    }
  };

  const captureReference = async () => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new AudioEngine();
      await audioEngineRef.current.init();
    }
    
    setIsRecordingReference(true);
    setTimeout(() => {
      if (audioEngineRef.current) {
        const freqData = audioEngineRef.current.getFrequencyData();
        const fingerprint = audioEngineRef.current.getFingerprint(freqData);
        setSettings(prev => ({ ...prev, referenceFingerprint: fingerprint }));
        setIsRecordingReference(false);
        alert("样本声音录入成功！");
      }
    }, 1500);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
      }
      const arrayBuffer = await file.arrayBuffer();
      const fingerprint = await audioEngineRef.current.getFingerprintFromBuffer(arrayBuffer);
      setSettings(prev => ({ ...prev, referenceFingerprint: fingerprint }));
      alert(`样本文件 "${file.name}" 解析成功。`);
    } catch (err) {
      alert("处理音频文件失败。");
    }
    if (event.target) event.target.value = '';
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-950 text-slate-100 overflow-hidden border-x border-slate-800 shadow-2xl">
      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <Activity className={`w-6 h-6 ${isMonitoring ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
          <h1 className="text-xl font-bold tracking-tight">AudioPulse <span className="text-blue-500">AI</span></h1>
        </div>
        <div className="flex gap-2">
          {isMonitoring ? (
            <button onClick={toggleMonitoring} className="p-2 bg-red-500/20 text-red-500 rounded-full border border-red-500/40 active:scale-95 transition-all">
              <Square className="w-5 h-5 fill-current" />
            </button>
          ) : (
            <button onClick={toggleMonitoring} className="p-2 bg-blue-600 text-white rounded-full shadow-lg shadow-blue-600/30 active:scale-95 transition-all">
              <Play className="w-5 h-5 fill-current" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
        
        {activeTab === 'monitor' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {isMonitoring && (
              <div className={`p-2 rounded-xl flex items-center justify-center gap-2 text-[10px] uppercase font-black tracking-widest ${wakeLock ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500'}`}>
                {wakeLock ? <Sun className="w-3 h-3" /> : (wakeLockSupported ? <Moon className="w-3 h-3" /> : <XCircle className="w-3 h-3" />)}
                {wakeLock ? '屏幕常亮已开启' : '系统自动休眠中'}
              </div>
            )}

            <section className={`relative bg-slate-900 border transition-all duration-300 rounded-3xl p-6 space-y-5 ${isHitActive ? 'border-blue-400 ring-4 ring-blue-500/10 bg-blue-900/20' : 'border-slate-800'}`}>
              <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-xl transition-all duration-300 flex items-center gap-2 ${isHitActive ? 'bg-blue-500 text-white translate-y-0 opacity-100 scale-100' : 'bg-slate-800 text-slate-500 opacity-0 translate-y-2 scale-90'}`}>
                <Zap className="w-3 h-3 fill-current" /> 捕捉到匹配声音
              </div>

              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest block">实时声纹距离</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-4xl font-mono font-black tabular-nums tracking-tighter transition-colors ${isHitActive ? 'text-blue-400' : 'text-slate-200'}`}>
                      {(displayDistance * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="text-right">
                   <span className="text-slate-600 text-[10px] font-bold uppercase tracking-widest block">触发阈值</span>
                   <span className="text-red-500 font-mono font-bold">{(settings.threshold * 100).toFixed(0)}%</span>
                </div>
              </div>
              
              <div className="relative h-7 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 p-1">
                <div className="absolute inset-y-0 left-0 bg-emerald-500/5 border-r border-emerald-500/20" style={{ width: `${settings.threshold * 100}%` }} />
                <div className={`h-full rounded-lg transition-all duration-100 ease-out ${isHitActive ? 'bg-gradient-to-r from-blue-700 to-blue-400' : 'bg-slate-700'}`} style={{ width: `${displayDistance * 100}%` }} />
                <div className="absolute inset-y-0 border-l-2 border-red-500/60 z-10 flex flex-col items-center" style={{ left: `${settings.threshold * 100}%` }}>
                  <div className="bg-red-500 h-2 w-0.5 rounded-full" />
                  <div className="flex-1 w-px bg-red-500/30" />
                  <div className="bg-red-500 h-2 w-0.5 rounded-full" />
                </div>
              </div>

              <div className="flex justify-between items-center text-[9px] text-slate-600 font-black uppercase tracking-widest px-1">
                <span className="text-blue-400/80">完全匹配 (0%)</span>
                <span>差异极大</span>
              </div>

              {isMonitoring && (
                <div className="pt-3 border-t border-slate-800/50 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 shrink-0">
                    <Mic className={`w-3.5 h-3.5 ${micLevel > 0.05 ? 'text-blue-400' : 'text-slate-600'}`} />
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">环境音量</span>
                  </div>
                  <div className="flex-1 h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-600 transition-all duration-75" style={{ width: `${micLevel * 100}%` }} />
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <Waves className="w-3.5 h-3.5 text-blue-400" /> 分析趋势图 (距离越低越匹配)
                </h3>
              </div>
              <Visualizer data={chartData} threshold={settings.threshold} onPointHover={setHoveredDistance} />
            </section>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 flex flex-col items-center justify-center space-y-1">
                <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest">累计匹配次数</p>
                <p className="text-4xl font-mono font-black text-blue-400 tabular-nums">{history.length}</p>
              </div>
              <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 flex flex-col items-center justify-center space-y-1">
                <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest">匹配置信度</p>
                <p className="text-3xl font-mono font-black text-slate-500 tabular-nums">
                  {history.length > 0 ? (100 - (history[0].distance * 100)).toFixed(0) : 0}%
                </p>
              </div>
            </div>

            {!settings.referenceFingerprint && (
              <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-3xl flex items-center gap-4">
                <Target className="w-8 h-8 text-amber-500 shrink-0" />
                <div className="space-y-1">
                  <p className="text-amber-200 text-xs font-black uppercase tracking-widest">等待声音建模</p>
                  <p className="text-amber-200/60 text-[10px]">请在“设置”页录入一段样例声音作为对比目标。</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-bold tracking-tight">历史识别记录</h2>
              <button onClick={clearHistory} className="text-[10px] font-bold text-red-400 flex items-center gap-1.5 px-4 py-2 bg-red-400/10 rounded-2xl border border-red-400/20">
                <Trash2 className="w-3 h-3" /> 清空记录
              </button>
            </div>
            {history.length === 0 ? (
              <div className="text-center py-24 opacity-20">
                <HistoryIcon className="w-16 h-16 mx-auto mb-4" />
                <p className="font-bold uppercase tracking-widest text-xs">暂无统计数据</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item, idx) => (
                  <div key={item.id} className="bg-slate-900 p-4 rounded-3xl border border-slate-800 flex items-center justify-between shadow-md">
                    <div className="flex items-center gap-4">
                      <div className="p-3.5 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                        <span className="text-blue-400 font-black font-mono">#{history.length - idx}</span>
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-100 tracking-tight">成功匹配</p>
                        <p className="text-[10px] text-slate-500 font-bold tabular-nums">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour12: false })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-mono font-black text-blue-400">{(100 - item.distance * 100).toFixed(0)}%</p>
                      <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest">相似度</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="space-y-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-600 flex items-center gap-2 px-1">
                <Mic className="w-4 h-4" /> 样本声音采集
              </h2>
              <div className="bg-slate-900 p-6 rounded-[2.5rem] border border-slate-800 space-y-6 shadow-xl">
                <div className="text-center space-y-4">
                  <div className={`w-24 h-24 rounded-[2rem] border-2 transition-all duration-500 mx-auto flex items-center justify-center ${isRecordingReference ? 'border-red-500 animate-pulse bg-red-500/10 scale-110' : 'border-slate-700 bg-slate-950 shadow-inner'}`}>
                    <Mic className={`w-10 h-10 ${isRecordingReference ? 'text-red-500' : 'text-slate-500'}`} />
                  </div>
                  <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.3em]">{isRecordingReference ? "正在聆听样本..." : "当前无声音模板"}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={captureReference} disabled={isRecordingReference} className="flex flex-col items-center justify-center gap-3 p-6 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-3xl font-black shadow-xl active:scale-95 transition-all text-[11px] uppercase tracking-wider">
                    <Mic className="w-6 h-6" /> 现场录制
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-3xl font-black active:scale-95 transition-all text-[11px] uppercase tracking-wider border border-slate-700">
                    <Upload className="w-6 h-6" /> 文件上传
                  </button>
                  <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
                </div>
                {settings.referenceFingerprint && (
                  <div className="flex items-center gap-4 px-5 py-5 bg-blue-500/5 border border-blue-500/10 rounded-3xl">
                    <FileAudio className="w-6 h-6 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest block">声纹库已生效</span>
                    </div>
                    <button onClick={() => setSettings({...settings, referenceFingerprint: null})} className="p-3 text-red-500/40 hover:text-red-500 transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-600 flex items-center gap-2 px-1">
                <Settings className="w-4 h-4" /> 参数校准
              </h2>
              <div className="bg-slate-900 p-7 rounded-[2.5rem] border border-slate-800 space-y-10 shadow-xl">
                <div className="space-y-5">
                  <div className="flex justify-between items-end">
                    <label className="text-xs font-black text-slate-300 uppercase tracking-widest">匹配阈值 (数值越低越严苛)</label>
                    <span className="text-2xl font-mono font-black text-blue-400">{(settings.threshold * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min="0.05" max="0.75" step="0.01" value={settings.threshold} onChange={(e) => setSettings({...settings, threshold: parseFloat(e.target.value)})} className="w-full h-3 bg-slate-800 rounded-xl appearance-none cursor-pointer accent-blue-500" />
                </div>
                <div className="space-y-5">
                  <div className="flex justify-between items-end">
                    <label className="text-xs font-black text-slate-300 uppercase tracking-widest">防抖间隔 (冷却时间)</label>
                    <span className="text-2xl font-mono font-black text-blue-400">{settings.cooldownSeconds}s</span>
                  </div>
                  <input type="range" min="0.1" max="10" step="0.1" value={settings.cooldownSeconds} onChange={(e) => setSettings({...settings, cooldownSeconds: parseFloat(e.target.value)})} className="w-full h-3 bg-slate-800 rounded-xl appearance-none cursor-pointer accent-blue-500" />
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Nav Dock */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/90 backdrop-blur-3xl border-t border-slate-800/40 flex items-center justify-around py-6 px-8 z-50 rounded-t-[3.5rem] shadow-2xl">
        <button onClick={() => setActiveTab('monitor')} className={`flex flex-col items-center gap-2 transition-all duration-300 ${activeTab === 'monitor' ? 'text-blue-500 scale-110 -translate-y-2' : 'text-slate-600'}`}>
          <div className={`p-3 rounded-2xl transition-all ${activeTab === 'monitor' ? 'bg-blue-500/15 shadow-xl ring-1 ring-blue-500/20' : ''}`}>
            <Activity className="w-7 h-7" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest">实时分析</span>
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center gap-2 transition-all duration-300 ${activeTab === 'history' ? 'text-blue-500 scale-110 -translate-y-2' : 'text-slate-600'}`}>
          <div className={`p-3 rounded-2xl transition-all ${activeTab === 'history' ? 'bg-blue-500/15 shadow-xl ring-1 ring-blue-500/20' : ''}`}>
            <HistoryIcon className="w-7 h-7" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest">匹配统计</span>
        </button>
        <button onClick={() => setActiveTab('settings')} className={`flex flex-col items-center gap-2 transition-all duration-300 ${activeTab === 'settings' ? 'text-blue-500 scale-110 -translate-y-2' : 'text-slate-600'}`}>
          <div className={`p-3 rounded-2xl transition-all ${activeTab === 'settings' ? 'bg-blue-500/15 shadow-xl ring-1 ring-blue-500/20' : ''}`}>
            <Settings className="w-7 h-7" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest">配置录入</span>
        </button>
      </nav>
    </div>
  );
};

export default App;