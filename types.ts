
export interface DetectionRecord {
  id: string;
  timestamp: number;
  distance: number;
  threshold: number;
}

export interface AppSettings {
  threshold: number;
  haWebhookUrl: string;
  cooldownSeconds: number;
  referenceFingerprint: number[] | null;
}

export interface AudioFrame {
  time: string;
  distance: number;
  threshold: number;
}
