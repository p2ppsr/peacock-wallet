import { FC } from 'react';
import { Typography, Button, Box, IconButton, Stack, Tooltip } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import Action from './Action';
import { WalletAction } from '@bsv/sdk';
import AppLogo from './AppLogo';

// Import the TransformedWalletAction interface
interface TransformedWalletAction extends WalletAction {
  amount: number;
  fees?: number;
}

interface RecentActionsProps {
  loading: boolean;
  appActions: TransformedWalletAction[];
  displayLimit: number;
  setDisplayLimit: (limit: number) => void;
  setRefresh: (refresh: boolean) => void;
  onRefresh?: () => void;
  allActionsShown?: boolean;
}

const RecentActions: FC<RecentActionsProps> = ({
  loading,
  appActions,
  displayLimit,
  setDisplayLimit,
  setRefresh,
  onRefresh,
  allActionsShown = false,
}) => {
  return (
    <div style={{ paddingTop: '1em' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography
          variant="h3"
          color="textPrimary"
          gutterBottom
          style={{ paddingBottom: '0.2em' }}
        >
          Recent Actions
        </Typography>
        {onRefresh && (
          <Tooltip title={loading ? 'Refreshing activity…' : 'Refresh activity'}>
            <span>
              <IconButton
                aria-label="Refresh recent actions"
                onClick={onRefresh}
                disabled={loading}
                size="small"
              >
                <RefreshRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
    {appActions?.length ? (
      appActions.map((action, idx) => {
        const actionToDisplay = {
          txid: action.txid,
          description: action.description,
          amount: String(action.amount),
          inputs: action.inputs,
          outputs: action.outputs,
          fees: action.fees != null ? String(action.fees) : undefined,
        }
        const key = action.txid ?? `action-${idx}`
        return <Action key={key} {...actionToDisplay} />
      })
    ) : (
      !loading && (
        <Typography color="textSecondary" align="center" style={{ paddingTop: '6em' }}>
          You haven't made any actions yet.
        </Typography>
      )
    )}
      {loading && <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={100} /></Box>}
      {appActions && appActions.length !== 0 && (
        <center style={{ paddingTop: '1em' }}>
          {allActionsShown ? (
            <></>
          ) : (
            <Button
              onClick={() => {
                // Note: Consider taking into account max number of transactions available
                setDisplayLimit(displayLimit + 10);
                setRefresh(true);
              }}
            >
              View More Actions
            </Button>
          )}
        </center>
      )}
    </div>
  );
};

export default RecentActions;
