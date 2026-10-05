import { useTranslation } from 'react-i18next'

import { InvitesCard } from './InvitesCard'
import { UsersCard } from './UsersCard'

export function AdminPage() {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
      <InvitesCard />
      <UsersCard />
    </div>
  )
}
