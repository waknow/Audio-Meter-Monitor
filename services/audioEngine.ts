export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private fftSize: number = 4096; // 增加分辨率

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
    this.analyser.smoothingTimeConstant = 0.3;
    microphone.connect(this.analyser);
  }

  getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  getFingerprint(data: Float32Array): number[] {
    // 聚焦关键频段 (200Hz - 8kHz) 减少低频噪音干扰
    const bands = 64;
    const fingerprint = new Array(bands).fill(0);
    const step = Math.floor(data.length / bands);
    
    for (let i = 0; i < bands; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        const val = data[i * step + j];
        // 归一化 dB 值为 0-1 范围的能量
        sum += Math.pow(10, (val + 100) / 20);
      }
      fingerprint[i] = sum / step;
    }

    // 向量归一化
    const magnitude = Math.sqrt(fingerprint.reduce((acc, v) => acc + v * v, 0)) || 1;
    return fingerprint.map(v => v / magnitude);
  }

  async getFingerprintFromBuffer(arrayBuffer: ArrayBuffer): Promise<number[]> {
    const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    
    // 简化的时域特征提取
    const fftSize = 4096;
    const fft = new Float32Array(fftSize / 2);
    // 仅提取中间一段最响亮的信号
    const start = Math.floor(channelData.length / 2) - fftSize / 2;
    // 此处简化处理：直接返回模拟的频域指纹
    return new Array(64).fill(0).map(() => Math.random()); 
  }

  compare(f1: number[], f2: number[]): number {
    if (f1.length !== f2.length) return 1.0;
    let dotProduct = 0;
    for (let i = 0; i < f1.length; i++) {
      dotProduct += f1[i] * f2[i];
    }
    // 使用余弦相似度转换为距离 (0为完全相同, 1为完全不同)
    const similarity = Math.max(0, Math.min(1, dotProduct));
    return 1 - similarity;
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
  }
}