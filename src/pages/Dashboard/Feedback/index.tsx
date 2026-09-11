import { useContext, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import FeedbackRoundedIcon from '@mui/icons-material/FeedbackRounded'
import { toast } from 'react-toastify'
import { UserContext } from '../../../UserContext'
import {
  MAX_EMAIL_LENGTH,
  MAX_FEEDBACK_LENGTH,
  MIN_FEEDBACK_LENGTH,
  submitFeedback
} from '../../../feedback'
import { reportDiagnosticError, reportDiagnosticEvent } from '../../../diagnostics'

type SubmitState = 'idle' | 'submitting' | 'sent' | 'failed'

const Feedback: React.FC = () => {
  const { appVersion } = useContext(UserContext)
  const [feedback, setFeedback] = useState('')
  const [email, setEmail] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const trimmedFeedback = feedback.trim()
  const canSubmit = trimmedFeedback.length >= MIN_FEEDBACK_LENGTH && submitState !== 'submitting'
  const remainingCharacters = useMemo(
    () => MAX_FEEDBACK_LENGTH - feedback.length,
    [feedback.length]
  )

  useEffect(() => {
    reportDiagnosticEvent('feedback.opened', { surface: 'wallet-feedback' })
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitState('submitting')
    reportDiagnosticEvent('feedback.submit_started', {
      surface: 'wallet-feedback',
      context: {
        messageLength: trimmedFeedback.length,
        hasContact: Boolean(email.trim())
      }
    })

    try {
      await submitFeedback({ feedback: trimmedFeedback, email })
      setFeedback('')
      setSubmitState('sent')
      reportDiagnosticEvent('feedback.client_acknowledged', { surface: 'wallet-feedback' })
      toast.success('Feedback sent. Thank you!')
    } catch (error) {
      setSubmitState('failed')
      reportDiagnosticError('feedback.failed', error, { surface: 'wallet-feedback' })
    }
  }

  const handleFeedbackChange = (value: string) => {
    setFeedback(value)
    if (submitState === 'sent' || submitState === 'failed') setSubmitState('idle')
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', px: { xs: 2, md: 3 }, py: 3 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <FeedbackRoundedIcon color="primary" sx={{ fontSize: 34 }} />
        <Typography variant="h1" color="textPrimary">Leave feedback</Typography>
      </Stack>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
        Tell the Project Babbage team what is working, what is confusing, or what you would like Peacock Wallet to do next.
      </Typography>

      <Paper
        component="form"
        elevation={0}
        onSubmit={handleSubmit}
        data-testid="wallet-feedback-form"
        data-proofrun="wallet-feedback-form"
        sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'background.paper' }}
      >
        <Stack spacing={2.5}>
          <Alert severity="warning">
            Do not include passwords, recovery phrases, private keys, full Identity Keys, transaction details, or private messages.
          </Alert>

          <TextField
            label="Your feedback"
            value={feedback}
            onChange={event => handleFeedbackChange(event.target.value)}
            placeholder="Tell us what happened or what would make the wallet better."
            multiline
            minRows={7}
            fullWidth
            autoFocus
            required
            disabled={submitState === 'submitting'}
            inputProps={{ minLength: MIN_FEEDBACK_LENGTH, maxLength: MAX_FEEDBACK_LENGTH }}
            helperText={`${remainingCharacters.toLocaleString()} characters remaining`}
          />

          <TextField
            label="Email (optional)"
            value={email}
            onChange={event => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            fullWidth
            disabled={submitState === 'submitting'}
            inputProps={{ maxLength: MAX_EMAIL_LENGTH }}
            helperText="Add an address only if you would like a reply."
          />

          <Typography variant="body2" color="textSecondary">
            Your message is sent to Project Babbage support through Usercom with this app version ({appVersion}).
            It does not include your wallet identity, keys, balances, transactions, certificates, or messages.
          </Typography>

          {submitState === 'submitting' && <LinearProgress aria-label="Sending feedback" />}
          {submitState === 'sent' && (
            <Alert severity="success" data-testid="wallet-feedback-sent">
              Feedback sent. Thank you for helping improve Peacock Wallet.
            </Alert>
          )}
          {submitState === 'failed' && (
            <Alert severity="error" data-testid="wallet-feedback-failed">
              We could not send your feedback. Your text is still here so you can try again.
            </Alert>
          )}

          <Box>
            <Button
              type="submit"
              variant="contained"
              disabled={!canSubmit}
              data-testid="wallet-feedback-submit"
              data-proofrun="wallet-feedback-submit"
              sx={{ minWidth: 150, textTransform: 'none' }}
            >
              {submitState === 'submitting' ? 'Sending…' : 'Send feedback'}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}

export default Feedback
