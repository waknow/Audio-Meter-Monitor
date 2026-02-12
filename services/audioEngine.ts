
/**
 * AudioEngine handles the Web Audio API lifecycle.
 * It computes a Mel-frequency spectral envelope (MFCC-lite).
 * Comparison is based on Euclidean Distance: 0.0 = Identical, 1.0 = Max Difference.
 */

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private fftSize: number = 2048;
  private melBands: number = 40;

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.microphone = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.2; // Reduce jitter for distance stability
    this.microphone.connect(this.analyser);
  }

  getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  async getFingerprintFromBuffer(arrayBuffer: ArrayBuffer): Promise<number[]> {
    const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    
    const offlineCtx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = this.fftSize;
    
    source.connect(analyser);
    analyser.connect(offlineCtx.destination);
    
    source.start(0);
    await offlineCtx.startRendering();
    
    const freqData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(freqData);
    
    const fingerprint = this.getFingerprint(freqData);
    tempCtx.close();
    return fingerprint;
  }

  /**
   * MFCC-lite implementation:
   * 1. Bin FFT to Mel-scale
   * 2. Log compression
   * 3. Normalization
   */
  getFingerprint(data: Float32Array): number[] {
    const binCount = data.length;
    const bands = this.melBands;
    const fingerprint = new Array(bands).fill(0);
    const sampleRate = this.audioCtx?.sampleRate || 44100;
    
    // Create Mel-filterbanks
    const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
    const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);
    
    const minMel = hzToMel(20); // Focus on human audible range
    const maxMel = hzToMel(sampleRate / 2);
    
    for (let i = 0; i < binCount; i++) {
      const freq = (i / binCount) * sampleRate / 2;
      if (freq < 20) continue;
      
      const mel = hzToMel(freq);
      const bandIndex = Math.floor(((mel - minMel) / (maxMel - minMel)) * bands);
      
      if (bandIndex >= 0 && bandIndex < bands) {
        // Convert dB to linear power roughly for binning
        const power = Math.pow(10, (data[i] + 100) / 20); 
        fingerprint[bandIndex] += power;
      }
    }
    
    // Log-power compression + Normalization
    const logFingerprint = fingerprint.map(v => Math.log10(v + 1));
    const magnitude = Math.sqrt(logFingerprint.reduce((acc, v) => acc + v * v, 0)) || 1;
    return logFingerprint.map(v => v / magnitude);
  }

  /**
   * Compares two footprints using Euclidean Distance.
   * Logic: Hit when distance < threshold.
   * Result is normalized 0.0 to 1.0.
   */
  compare(f1: number[], f2: number[]): number {
    if (f1.length !== f2.length) return 1.0;
    let sumSq = 0;
    for (let i = 0; i < f1.length; i++) {
      const diff = f1[i] - f2[i];
      sumSq += diff * diff;
    }
    const distance = Math.sqrt(sumSq);
    // Since vectors are normalized to length 1, max distance is sqrt(2)
    return Math.min(1.0, distance / 1.4142);
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
  }
}
