/*
  Demo x402-bch API server.
*/

// Global npm libraries
import { config } from 'dotenv'
import express from 'express'
import { paymentMiddleware } from 'x402-bch-express'

async function startServer () {
  try {
    // Load environment variables
    config()

    // Constants
    const facilitatorUrl = process.env.FACILITATOR_URL || 'http://localhost:4345/facilitator'
    const payTo = process.env.SERVER_BCH_ADDRESS || 'bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d'
    const port = process.env.PORT || 4021

    // Create express app
    const app = express()

    // Add x402 middleware
    app.use(
      paymentMiddleware(
        payTo,
        {
          'GET /weather': {
            minAmountRequired: 1000,
            config: {
              description: 'Access to weather data'
            }
          },
          network: 'bch'
        },
        {
          url: facilitatorUrl
        }
      )
    )

    // Weather endpoint
    app.get('/weather', (req, res) => {
      console.log('Serving /weather endpoint')
      res.send({
        report: {
          weather: 'sunny',
          temperature: 70
        }
      })
    })

    // Start server
    app.listen(port, () => {
      // console.log('Server is running on port 3000');
      console.log(`Server listening at http://localhost:${port}`)
    })
  } catch (err) {
    console.error('Error starting server:', err)
  }
}

startServer()
