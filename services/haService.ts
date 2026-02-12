
export const notifyHomeAssistant = async (webhookUrl: string, data: any) => {
  if (!webhookUrl) return;
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: 'gas_meter_click',
        ...data,
        timestamp: new Date().toISOString()
      }),
    });
    
    if (!response.ok) {
      console.error('HA Webhook failed:', response.statusText);
    }
  } catch (error) {
    console.error('Error notifying Home Assistant:', error);
  }
};
