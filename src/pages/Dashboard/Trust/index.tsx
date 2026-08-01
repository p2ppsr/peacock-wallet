/* eslint-disable indent */
import { useState, useContext, useEffect, useCallback, type ChangeEvent } from 'react'
import { Typography, Button, Slider, TextField, LinearProgress, Snackbar, Box, Paper } from '@mui/material'
import style from './style'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext'
import { useTheme } from '@mui/material/styles'
import useSxStyles from '../../../utils/useSxStyles'

import TrustedEntity from './TrustedEntity'
import arraysOfObjectsAreEqual from '../../../utils/arraysOfObjectsAreEqual'
import AddEntityModal from './AddEntityModal'
import type { Certifier } from '@bsv/wallet-toolbox-client'

const Trust: React.FC = () => {
  const { settings, updateSettings } = useContext(WalletContext)
  const theme = useTheme()
  const styles = useSxStyles(style)

  const cloneTrustedCertifiers = useCallback((certifiers: Certifier[]) => certifiers.map(certifier => ({ ...certifier })), [])

  const resolveTrustLevel = useCallback((value?: number) => (typeof value === 'number' ? value : 2), [])

  // These are some hard-coded defaults, if the user doesn't have any in Settings.
  const [trustLevel, setTrustLevel] = useState<number>(resolveTrustLevel(settings.trustSettings.trustLevel))
  const [trustedEntities, setTrustedEntities] = useState<Certifier[]>(() => cloneTrustedCertifiers(settings.trustSettings.trustedCertifiers))
  const [search, setSearch] = useState<string>('')
  const [addEntityModalOpen, setAddEntityModalOpen] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsNeedsUpdate, setSettingsNeedsUpdate] = useState(true)
  const totalTrustPoints = trustedEntities.reduce((accumulator, entity) => accumulator + entity.trust, 0)

  useEffect(() => {
    if (trustLevel > totalTrustPoints) {
      setTrustLevel(totalTrustPoints)
    }
  }, [totalTrustPoints])

  useEffect(() => {
    setTrustLevel(resolveTrustLevel(settings.trustSettings.trustLevel))
    setTrustedEntities(cloneTrustedCertifiers(settings.trustSettings.trustedCertifiers))
  }, [cloneTrustedCertifiers, resolveTrustLevel, settings.trustSettings.trustLevel, settings.trustSettings.trustedCertifiers])

  useEffect(() => {
    setSettingsNeedsUpdate((settings.trustSettings.trustLevel !== trustLevel) || (!arraysOfObjectsAreEqual(settings.trustSettings.trustedCertifiers, trustedEntities)))
  }, [trustedEntities, totalTrustPoints, trustLevel, settings])

  const shownTrustedEntities = trustedEntities.filter((entity: Certifier) => {
    if (!search) {
      return true
    }
    const query = search.toLowerCase()
    return (
      entity.name.toLowerCase().includes(query) ||
      entity.description.toLowerCase().includes(query)
    )
  })

  const handleSave = async (): Promise<boolean> => {
    try {
      setSettingsLoading(true)
      const savePromise = updateSettings(JSON.parse(JSON.stringify({
        ...settings,
        trustSettings: {
          trustLevel,
          trustedCertifiers: trustedEntities
        }
      })))
      await toast.promise(savePromise, {
        pending: 'Saving settings...',
        success: {
          render: 'Trust relationships updated!',
          autoClose: 2000
        },
        error: 'Failed to save settings! 🤯'
      })
      setSettingsNeedsUpdate(false)
      return true
    } catch (e: any) {
      toast.error(e.message)
      return false
    } finally {
      setSettingsLoading(false)
    }
  }

  return (
    <Box sx={styles.root}>
      <Typography variant='h1' color='textPrimary' sx={{ mb: 2 }}>
        Trust
      </Typography>
      <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
        Give points to show which certifiers you trust the most to confirm the identity of counterparties. More points mean a higher priority.
      </Typography>

      {settingsLoading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} sx={{ ...styles.section, p: 3, bgcolor: 'background.paper' }}>
        <Typography variant='h4' sx={{ mb: 2 }}>Trust Threshold</Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
          You've given out a total of <b>{totalTrustPoints} {totalTrustPoints === 1 ? 'point' : 'points'}</b>. Set the minimum points any counterparty must have across your trust network to be shown in any apps you use.
        </Typography>
        <Box sx={styles.trust_threshold}>
          <Box sx={styles.slider_label_grid}>
            <Typography><b>{trustLevel}</b> / {totalTrustPoints}</Typography>
            <Slider
              min={totalTrustPoints > 0 ? 1 : 0}
              max={Math.max(totalTrustPoints, totalTrustPoints > 0 ? 1 : 0)}
              step={1}
              onChange={(_, v) => setTrustLevel(v as number)}
              value={trustLevel}
            />
          </Box>
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ ...styles.section, p: 3, bgcolor: 'background.paper', mt: 3 }}>
        <Typography variant='h4' sx={{ mb: 2 }}>Certifier Network</Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 3 }}>
          People, businesses, and websites will need endorsement by these certifiers to show up in your apps. Otherwise, you'll see them as "Unknown Identity".
        </Typography>

        {/* UI Controls - Search and Add Buttons */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, mb: 2 }}>
          <TextField
            value={search}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            label='Search'
            placeholder='Filter providers...'
            fullWidth
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                startAdornment: <SearchIcon color='action' sx={{ mr: 1 }} />
              }
            }}
          />
          <Button
            variant='contained'
            color='primary'
            onClick={() => setAddEntityModalOpen(true)}
            startIcon={<AddIcon />}
            sx={{ minWidth: '200px' }}
          >
            Add Search Provider
          </Button>
        </Box>
        <Box flex={1}>
          {shownTrustedEntities.map(entity => (
            <Box key={`${entity.name}.${entity.description}.${entity.identityKey}`}>
              <TrustedEntity
                entity={entity}
                setTrustedEntities={setTrustedEntities}
              />
            </Box>
          ))}
        </Box>
      </Paper>

      <AddEntityModal
        open={addEntityModalOpen}
        setOpen={setAddEntityModalOpen}
        setTrustedEntities={setTrustedEntities}
      />

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center'
        }}
        open={settingsNeedsUpdate}
        message='You have unsaved changes!'
        action={
          <Button
            disabled={settingsLoading}
            variant='contained'
            color='primary'
            size='small'
            onClick={handleSave}
            sx={{ ml: 1 }}
          >
            {settingsLoading ? 'Saving...' : 'Save'}
          </Button>
        }
        ContentProps={{
          sx: {
            bgcolor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.shadows[6],
            display: 'flex',
            alignItems: 'center',
            fontSize: theme.typography.body2.fontSize
          }
        }}
      />
    </Box>
  )
}

export default Trust
