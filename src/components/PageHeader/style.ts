import { Theme } from '@mui/material/styles'

export default (theme: Theme) => ({
  top_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto auto 1fr auto',
    alignItems: 'center',
    gridGap: theme.spacing(2),
    boxSizing: 'border-box',
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: 'auto 1fr',
      '& > :nth-of-type(2)': {
        display: 'none'
      },
      '& > :nth-of-type(3)': {
        gridColumn: '2'
      },
      '& > :nth-of-type(4)': {
        gridColumn: '1 / -1',
        display: 'flex',
        flexWrap: 'wrap',
        gap: theme.spacing(1)
      }
    }
  },
  app_icon: {
    width: '5em',
    height: '5em',
  },
  action_button: {
    [theme.breakpoints.down('sm')]: {
      width: '100%'
    }
  },
  back_button: {
    marginRight: theme.spacing(1)
  }
})
