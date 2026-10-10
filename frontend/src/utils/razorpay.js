/**
 * Razorpay Checkout for plan upgrades and AI token packs.
 *
 * purchase() asks the backend to start a checkout. Free items come back already applied;
 * paid items return an order that is opened in Razorpay Checkout, and the payment is then
 * verified on the server before anything is granted.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
let scriptPromise = null

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = CHECKOUT_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => { scriptPromise = null; reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.')) }
      document.body.appendChild(s)
    })
  }
  return scriptPromise
}

async function post(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

/**
 * @param {string} startUrl  e.g. `${apiBaseUrl}/api/billing/checkout`
 * @returns {Promise<string|null>} success message, or null if the buyer closed Checkout
 */
export async function purchase({ apiBaseUrl = '', token, startUrl, body }) {
  const start = await post(startUrl, token, body)
  if (!start.requiresPayment) return start.message

  await loadCheckout()
  const response = await new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      ...start.checkout,
      theme: { color: '#06b6d4' },
      handler: resolve,
      modal: { ondismiss: () => resolve(null) }
    })
    rzp.on('payment.failed', (e) => reject(new Error(e?.error?.description || 'Payment failed.')))
    rzp.open()
  })
  if (!response) return null

  const verified = await post(`${apiBaseUrl}/api/billing/checkout/verify`, token, response)
  return verified.message
}

export function formatMoney(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Number(amount) % 1 ? 2 : 0 }).format(Number(amount) || 0)
  } catch {
    return `${currency} ${amount}`
  }
}
