# P1 Dashboard And Navigation i18n Fixes

Source reviewed: `docs/i18n-priority-fixes.md`

Scope implemented: dashboard, sidebar/mobile navigation, organization switcher, account/org cards, search bars, header actions, and common app-shell navigation visible from the dashboard.

## Counts

| Metric | Count |
|---|---:|
| P1 findings reviewed | 114 |
| Dashboard/navigation findings selected | 14 |
| Selected findings fixed before this change | 0 |
| Selected findings remaining after this change | 0 |

## Implemented Findings

| File | Current text | Translation key | Malayalam translation | Italian translation | User impact |
|---|---|---|---|---|---|
| `src/components/MobileAppLayout.tsx` | Home | `nav.home` | ഹോം | Home | Mobile header accessible label no longer stays English in Malayalam. |
| `src/pages/Dashboard.tsx` | Open dashboard filters | `dashboard.openFilters` | ഡാഷ്‌ബോർഡ് ഫിൽട്ടറുകൾ തുറക്കുക | Apri filtri dashboard | Mobile dashboard filter trigger is localized for screen readers and visible trigger labels. |
| `src/components/OrgSwitcher.tsx` | Failed to switch organization | `organizations.failedToSwitchOrganization` | സംഘടന മാറ്റാൻ പരാജയപ്പെട്ടു | Impossibile cambiare organizzazione | Organization switch failure toast no longer appears in English. |
| `src/components/OrgSwitcher.tsx` | Loading… | `org.loading` | ലോഡ് ചെയ്യുന്നു… | Caricamento… | Sidebar organization loading state is localized. |
| `src/components/OrgSwitcher.tsx` | Switch organization | `org.switchOrganization` | സ്ഥാപനം മാറ്റുക | Cambia organizzazione | Organization switcher button accessible label is localized. |
| `src/components/OrgSwitcher.tsx` | Personal | `org.personal` | വ്യക്തിഗതം | Personale | Personal workspace fallback and badge no longer remain English. |
| `src/components/OrgSwitcher.tsx` | Search organizations… | `org.searchOrganizations` | സ്ഥാപനങ്ങൾ തിരയുക… | Cerca organizzazioni… | Organization switcher search placeholder is localized. |
| `src/components/OrgSwitcher.tsx` | No organizations match | `org.noOrganizationsMatch` | ഒത്തുപോകുന്ന സ്ഥാപനങ്ങളില്ല | Nessuna organizzazione corrisponde | Organization switcher empty search state is localized. |
| `src/components/OrgSwitcher.tsx` | Create organization | `org.createOrganization` | സ്ഥാപനം ഉണ്ടാക്കുക | Crea organizzazione | Header/sidebar organization action is localized. |
| `src/components/OrgSwitcher.tsx` | Manage organizations | `org.manageOrganizations` | സ്ഥാപനങ്ങൾ കൈകാര്യം ചെയ്യുക | Gestisci organizzazioni | Header/sidebar organization management action is localized. |
| `src/components/OrgSwitcher.tsx` | owner | `org.roleOwner` | ഉടമ | proprietario | Organization role label no longer stays English. |
| `src/components/OrgSwitcher.tsx` | admin | `org.roleAdmin` | അഡ്മിൻ | admin | Organization role label uses i18n where shown by the switcher. |
| `src/components/OrgSwitcher.tsx` | editor | `org.roleEditor` | എഡിറ്റർ | editor | Organization role label uses i18n where shown by the switcher. |
| `src/components/OrgSwitcher.tsx` | viewer | `org.roleViewer` | വ്യൂവർ | visualizzatore | Organization role label uses i18n where shown by the switcher. |

## Notes

- Organization names remain user-entered content and were not translated.
- Brand text such as `ProfitSync` remains unchanged.
- Existing English text was preserved in `en.json`; code now references keys through the existing i18n system.
