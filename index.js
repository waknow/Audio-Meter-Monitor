import React from 'react';
import ReactDOM from 'react-dom/client';
import htm from 'htm';
import * as Lucide from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  ReferenceLine,
  YAxis,
  XAxis,
  Tooltip
} from 'recharts';

const { useState, useEffect, useRef } = React;
const html = htm.bind(React.createElement);

// --- 音频算法引擎 ---
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
  }

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { 
        echoCancellation: false, 
        noiseSuppression: false, 
        autoGainControl: false 
      } 
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.3;
    source.connect(this.analyser);
  }

  getFrequencyData() {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  extractFingerprint(data) {
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
    const mag = Math.sqrt(fp.reduce((a, b) => a + b * b, 0)) || 1;
    return fp.map(v => v / mag);
  }

  async extractFingerprintFromBuffer(arrayBuffer) {
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    
    let maxAmp = 0;
    let maxIdx = 0;
    for(let i=0; i < channelData.length; i += 1024) {
      if(Math.abs(channelData[i]) > maxAmp) {
        maxAmp = Math.abs(channelData[i]);
        maxIdx = i;
      }
    }
    
    const bands = 64;
    const fp = new Array(bands).fill(0);
    for(let i=0; i<bands; i++) {
       let sum = 0;
       const start = maxIdx + (i * 20);
       for(let j=0; j<100 && (start+j) < channelData.length; j++) {
         sum += Math.abs(channelData[start + j]);
       }
       fp[i] = sum;
    }
    const mag = Math.sqrt(fp.reduce((a, b) => a + b * b, 0)) || 1;
    return fp.map(v => v / mag);
  }

  compare(f1, f2) {
    let dot = 0;
    for (let i = 0; i < f1.length; i++) dot += f1[i] * f2[i];
    const similarity = Math.max(0, Math.min(1, dot));
    return 1 - similarity; 
  }

  close() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
  }
}

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const { d, t } = payload[0].payload;
    return html`
      <div className="bg-slate-900/95 border border-blue-500/50 p-3 rounded-2xl shadow-2xl backdrop-blur-xl pointer-events-none">
        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">采样具体距离</p>
        <p className="text-xl font-mono font-black text-white">
          ${(d * 100).toFixed(2)}%
        </p>
        <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-tight">${t}</p>
      </div>
    `;
  }
  return null;
};

const NavBtn = ({ active, onClick, icon, label }) => {
  return html`
    <button onClick=${onClick} className=${`flex flex-col items-center gap-1.5 transition-all ${active ? 'text-blue-500 scale-105' : 'text-slate-600'}`}>
      <div className=${`p-2 rounded-2xl transition-all ${active ? 'bg-blue-500/15' : ''}`}>
        ${React.cloneElement(icon, { size: 22, strokeWidth: active ? 3 : 2 })}
      </div>
      <span className="text-[9px] font-black uppercase tracking-wider">${label}</span>
    </button>
  `;
};

const App = () => {
  const [activeTab, setActiveTab] = useState('monitor');
  const [isLive, setIsLive] = useState(false);
  const [isSampling, setIsSampling] = useState(false);
  const [currentDist, setCurrentDist] = useState(1); 
  const [deleteStep, setDeleteStep] = useState(0); // 0: 正常, 1: 待确认清空

  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('audio_pulse_history_v8');
    return saved ? JSON.parse(saved) : [];
  });
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('audio_pulse_config_v8');
    return saved ? JSON.parse(saved) : { 
      threshold: 0.15, 
      cooldown: 1.5, 
      fingerprint: null,
      webhookUrl: '' 
    };
  });

  const [chartData, setChartData] = useState([]);
  const [wakeLock, setWakeLock] = useState(null);
  const [lastMatchAt, setLastMatchAt] = useState(0);
  const [isHighlighting, setIsHighlighting] = useState(false);

  const engineRef = useRef(null);
  const fileInputRef = useRef(null);
  const chartCounter = useRef(0);

  // 持久化存储
  useEffect(() => {
    localStorage.setItem('audio_pulse_history_v8', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('audio_pulse_config_v8', JSON.stringify(config));
  }, [config]);

  // 定时重置删除确认状态
  useEffect(() => {
    if (deleteStep === 1) {
      const timer = setTimeout(() => setDeleteStep(0), 3000);
      return () => clearTimeout(timer);
    }
  }, [deleteStep]);

  const requestWakeLock = async (on) => {
    if ('wakeLock' in navigator) {
      try {
        if (on && !wakeLock) {
          const lock = await navigator.wakeLock.request('screen');
          setWakeLock(lock);
        } else if (!on && wakeLock) {
          await wakeLock.release();
          setWakeLock(null);
        }
      } catch (err) { console.warn('WakeLock failed', err); }
    }
  };

  useEffect(() => {
    let anim;
    const process = () => {
      if (!engineRef.current || !isLive) return;
      const data = engineRef.current.getFrequencyData();
      if (data.length === 0) { anim = requestAnimationFrame(process); return; }

      const currentFp = engineRef.current.extractFingerprint(data);
      let dist = 1;
      if (config.fingerprint) {
        dist = engineRef.current.compare(config.fingerprint, currentFp);
      }

      setCurrentDist(dist);
      
      const nowTime = new Date();
      const tStr = `${nowTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}.${nowTime.getMilliseconds().toString().padStart(3, '0')}`;
      
      setChartData(prev => {
        const next = [...prev.slice(-59), { 
          d: dist, 
          t: tStr, 
          id: chartCounter.current++ // 使用独立自增 ID 保证 X 轴对齐
        }];
        return next;
      });

      const now = Date.now();
      if (dist > config.threshold && (now - lastMatchAt) > config.cooldown * 1000) {
        handleMatch(dist);
        setLastMatchAt(now);
      }

      anim = requestAnimationFrame(process);
    };

    if (isLive) anim = requestAnimationFrame(process);
    return () => cancelAnimationFrame(anim);
  }, [isLive, config.fingerprint, config.threshold, config.cooldown, lastMatchAt]);

  const handleMatch = async (dist) => {
    const record = { id: Math.random().toString(36).substr(2, 9), time: Date.now(), distance: dist };
    setHistory(prev => [record, ...prev].slice(0, 1000));
    setIsHighlighting(true);
    setTimeout(() => setIsHighlighting(false), 400);
    
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    if (config.webhookUrl) {
      try {
        fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'audio_pulse_detected',
            distance: (dist * 100).toFixed(2),
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});
      } catch (e) {}
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!engineRef.current) engineRef.current = new AudioEngine();
    try {
      const buffer = await file.arrayBuffer();
      const fp = await engineRef.current.extractFingerprintFromBuffer(buffer);
      setConfig(prev => ({ ...prev, fingerprint: fp }));
      alert('指纹提取成功！');
    } catch (err) {
      alert('音频解析失败。');
    }
  };

  // 重构清空逻辑：移除 confirm()，改为可靠的 UI 确认
  const handleClearClick = () => {
    if (deleteStep === 0) {
      setDeleteStep(1);
    } else {
      setHistory([]);
      localStorage.removeItem('audio_pulse_history_v8');
      setDeleteStep(0);
      if (navigator.vibrate) navigator.vibrate(50);
    }
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
    setTimeout(() => {
      const data = engineRef.current.getFrequencyData();
      const fp = engineRef.current.extractFingerprint(data);
      setConfig(prev => ({ ...prev, fingerprint: fp }));
      setIsSampling(false);
      if (navigator.vibrate) navigator.vibrate(200);
    }, 1200);
  };

  return html`
    <div className="flex flex-col h-screen max-w-md mx-auto relative select-none bg-slate-950">
      <header className="p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className=${`p-2.5 rounded-2xl transition-all ${isLive ? 'bg-blue-500/20' : 'bg-slate-800'}`}>
            <${Lucide.Activity} className=${`w-6 h-6 ${isLive ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter leading-none text-white">声音统计器</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">AudioPulse Pro v8</p>
          </div>
        </div>
        <button 
          onClick=${toggleMonitor}
          className=${`px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest transition-all active:scale-90 shadow-xl ${
            isLive ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-blue-600 text-white shadow-blue-600/20'
          }`}
        >
          ${isLive ? '停止分析' : '开始分析'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar px-6 space-y-6 pb-28 z-10">
        ${activeTab === 'monitor' && html`
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className=${`glass-card rounded-[3rem] p-12 flex flex-col items-center justify-center transition-all ${isHighlighting ? 'animate-hit border-blue-500/50' : ''}`}>
              <span className="text-[11px] text-slate-500 font-black uppercase tracking-[0.2em] mb-2">匹配次数</span>
              <div className="flex items-baseline gap-2">
                <span className="text-9xl font-mono font-black text-blue-400 drop-shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                  ${history.length}
                </span>
                <span className="text-xl font-black text-slate-600">次</span>
              </div>
            </div>

            <div className="glass-card rounded-[2.5rem] p-6 space-y-4">
              <div className="flex justify-between items-center px-2">
                <div className="flex items-center gap-2">
                  <${Lucide.Waves} className="w-4 h-4 text-blue-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">实时距离分析</span>
                </div>
                <span className="text-sm font-mono font-black text-blue-400">${(currentDist * 100).toFixed(1)}%</span>
              </div>
              
              <div className="h-44 w-full rounded-2xl bg-slate-900/50 overflow-hidden relative border border-white/5">
                <${ResponsiveContainer} width="100%" height="100%">
                  <${AreaChart} 
                    data=${chartData} 
                    margin=${{ top: 5, right: 0, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <${XAxis} dataKey="id" hide />
                    <${YAxis} domain=${[0, 1]} hide />
                    <${Tooltip} 
                      content=${html`<${CustomTooltip} />`} 
                      isAnimationActive=${false}
                      cursor=${{ stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '5 5' }}
                    />
                    <${ReferenceLine} 
                      y=${config.threshold} 
                      stroke="#ef4444" 
                      strokeDasharray="4 4" 
                      strokeWidth=${2}
                      label=${{ 
                        position: 'insideTopRight', 
                        value: `阈值: ${(config.threshold * 100).toFixed(0)}%`, 
                        fill: '#ef4444', 
                        fontSize: 10, 
                        fontWeight: '900',
                        dy: 12,
                        dx: -10
                      }}
                    />
                    <${Area} 
                      type="monotone" 
                      dataKey="d" 
                      stroke="#3b82f6" 
                      fill="url(#distGrad)" 
                      isAnimationActive=${false} 
                      strokeWidth=${3} 
                      baseValue="0"
                      activeDot=${{ r: 6, stroke: '#fff', strokeWidth: 2, fill: '#3b82f6' }}
                    />
                  </${AreaChart}>
                </${ResponsiveContainer} >
              </div>
              <div className="flex justify-between items-center px-2">
                <span className="text-[9px] text-slate-600 font-bold uppercase tracking-wider">
                    判定标准: 距离 > ${(config.threshold * 100).toFixed(0)}%
                </span>
                ${!isLive && html`<div className="flex items-center gap-1.5"><${Lucide.Info} size=${10} className="text-blue-400" /><span className="text-[9px] text-blue-400 font-black tracking-tight">暂停中 - 左右滑动查看点位数值</span></div>`}
              </div>
            </div>
          </div>
        `}

        ${activeTab === 'history' && html`
          <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">统计明细</h2>
              <button 
                onClick=${handleClearClick} 
                className=${`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${deleteStep === 1 ? 'bg-red-500 text-white' : 'text-slate-700 active:text-red-500'}`}
              >
                ${deleteStep === 1 ? html`<span className="text-[10px] font-black uppercase tracking-widest">确认清空？</span>` : ''}
                <${Lucide.Trash2} size=${deleteStep === 1 ? 16 : 20} />
              </button>
            </div>
            ${history.length === 0 ? html`
              <div className="py-24 flex flex-col items-center opacity-20 grayscale">
                <${Lucide.History} size=${64} className="mb-4" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white">暂无命中数据</span>
              </div>
            ` : html`
              <div className="space-y-3">
                ${history.map((h, i) => html`
                  <div key=${h.id} className="glass-card p-4 rounded-2xl flex items-center justify-between border-white/5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-xs font-mono font-black text-blue-400">
                        #${history.length - i}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-200">检测命中</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          ${new Date(h.time).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-blue-400">${(h.distance * 100).toFixed(1)}%</div>
                      <div className="text-[8px] font-black text-slate-600 uppercase">命中具体距离</div>
                    </div>
                  </div>
                `)}
              </div>
            `}
          </div>
        `}

        ${activeTab === 'setup' && html`
          <div className="space-y-8 pb-10 animate-in slide-in-from-left-4 duration-300">
            <section className="glass-card rounded-[2.5rem] p-8 space-y-6">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <${Lucide.Mic2} size=${14} className="text-blue-400" /> 特征样本采集
              </h3>
              <div className="flex flex-col items-center gap-6">
                <button 
                  onClick=${captureSample}
                  disabled=${isSampling}
                  className=${`relative w-36 h-36 rounded-full flex items-center justify-center transition-all ${
                    isSampling ? 'bg-red-500/20 scale-110 shadow-2xl' : 'bg-slate-900 border-2 border-slate-800 active:scale-95'
                  }`}
                >
                  <${Lucide.Mic} size=${48} className=${isSampling ? 'text-red-500 animate-pulse' : 'text-slate-600'} />
                  ${isSampling && html`<div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />`}
                </button>
                <div className="text-center space-y-4 w-full">
                  <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                    ${isSampling ? '录音中...' : config.fingerprint ? '指纹已录入' : '等待采样'}
                  </p>
                  <button 
                    onClick=${() => fileInputRef.current.click()}
                    className="flex items-center justify-center gap-2 w-full py-4 rounded-3xl bg-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >
                    <${Lucide.FileUp} size=${14} /> 上传音频指纹文件
                  </button>
                  <input ref=${fileInputRef} type="file" accept="audio/*" onChange=${handleFileUpload} className="hidden" />
                </div>
              </div>
            </section>

            <section className="glass-card rounded-[2.5rem] p-8 space-y-8">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <${Lucide.Settings2} size=${14} className="text-blue-400" /> 分析与冷却
              </h3>
              
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">判定距离阈值</label>
                  <span className="text-2xl font-mono font-black text-blue-400">${(config.threshold * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0.01" max="0.99" step="0.01" 
                  value=${config.threshold} 
                  onChange=${e => setConfig(prev => ({ ...prev, threshold: parseFloat(e.target.value) }))}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-6 pt-2 border-t border-white/5">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">命中间隔 (冷却时间)</label>
                  <span className="text-2xl font-mono font-black text-blue-400">${config.cooldown}s</span>
                </div>
                <input 
                  type="range" min="0.1" max="5.0" step="0.1" 
                  value=${config.cooldown} 
                  onChange=${e => setConfig(prev => ({ ...prev, cooldown: parseFloat(e.target.value) }))}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-4 pt-4 border-t border-white/5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Home Assistant Webhook</label>
                <input 
                  type="text"
                  placeholder="https://..."
                  value=${config.webhookUrl}
                  onChange=${e => setConfig(prev => ({ ...prev, webhookUrl: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 p-4 rounded-2xl text-xs text-slate-400 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </section>
          </div>
        `}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-950/90 backdrop-blur-3xl border-t border-white/5 px-8 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-between items-center z-50">
        <${NavBtn} active=${activeTab === 'monitor'} onClick=${() => setActiveTab('monitor')} icon=${html`<${Lucide.Target} />`} label="监控" />
        <${NavBtn} active=${activeTab === 'history'} onClick=${() => setActiveTab('history')} icon=${html`<${Lucide.LayoutList} />`} label="历史" />
        <${NavBtn} active=${activeTab === 'setup'} onClick=${() => setActiveTab('setup')} icon=${html`<${Lucide.Sliders} />`} label="设置" />
      </nav>
    </div>
  `;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
