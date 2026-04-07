import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const twilioNumber = process.env.TWILIO_PHONE_NUMBER

const client = twilio(accountSid, authToken)

export async function sendWhatsAppMessage(to: string, body: string) {
  try {
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
    const formattedFrom = twilioNumber?.startsWith('whatsapp:') ? twilioNumber : `whatsapp:${twilioNumber}`

    await client.messages.create({
      body,
      from: formattedFrom,
      to: formattedTo,
    })
  } catch (error) {
    console.error('Error sending WhatsApp message:', error)
    throw error
  }
}

export function generateTwiMLResponse(message: string) {
  const twiml = new twilio.twiml.MessagingResponse()
  twiml.message(message)
  return twiml.toString()
}
