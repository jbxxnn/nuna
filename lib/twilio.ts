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

export function verifyTwilioSignature({
  url,
  signature,
  params,
}: {
  url: string
  signature: string | null
  params: Record<string, string>
}) {
  if (process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === 'true') {
    return true
  }

  if (!authToken) {
    console.warn('TWILIO_AUTH_TOKEN is not set; skipping Twilio signature validation')
    return true
  }

  if (!signature) {
    return false
  }

  return twilio.validateRequest(authToken, signature, url, params)
}
