/* חיבור ל-Supabase. שני הערכים האלה ציבוריים מטבעם (מפתח publishable / anon) —
   ההגנה על הנתונים היא ה-RLS במסד. לעולם לא לשים כאן מפתח service_role / secret. */
window.APP_CONFIG = {
  url: 'https://YOUR-PROJECT.supabase.co',
  key: 'YOUR-PUBLISHABLE-KEY',
};
