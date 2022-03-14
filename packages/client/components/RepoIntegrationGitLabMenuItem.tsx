import graphql from 'babel-plugin-relay/macro'
import React, {forwardRef} from 'react'
import {createFragmentContainer} from 'react-relay'
import {RepoIntegrationGitLabMenuItem_repoIntegration} from '../__generated__/RepoIntegrationGitLabMenuItem_repoIntegration.graphql'
import GitLabSVG from './GitLabSVG'
import MenuItem from './MenuItem'
import MenuItemLabel from './MenuItemLabel'
import RepoIntegrationMenuItemAvatar from './RepoIntegrationMenuItemAvatar'
import TypeAheadLabel from './TypeAheadLabel'

interface Props {
  // repoIntegration: RepoIntegrationGitLabMenuItem_repoIntegration
  fullPath: string
  onClick: () => void
  query: string
}

const RepoIntegrationGitLabMenuItem = forwardRef((props: Props, ref: any) => {
  // const {query, repoIntegration, onClick} = props
  const {query, fullPath, onClick} = props
  // const {fullPath} = repoIntegration
  return (
    <MenuItem
      ref={ref}
      label={
        <MenuItemLabel>
          <RepoIntegrationMenuItemAvatar>
            <GitLabSVG />
          </RepoIntegrationMenuItemAvatar>
          {/* <TypeAheadLabel query={query} label={fullPath} /> */}
          {fullPath}
        </MenuItemLabel>
      }
      onClick={onClick}
    />
  )
})

export default RepoIntegrationGitLabMenuItem
