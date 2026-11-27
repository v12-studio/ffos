import { ArrowLeft } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageTitle } from '../components/AppShell.tsx';
import { Card } from '../components/ui.tsx';

function Topic({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className="group border-b border-line last:border-b-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-body font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-muted transition-transform group-open:rotate-45" aria-hidden>
          +
        </span>
      </summary>
      <div className="space-y-2 px-4 pb-4 text-label text-muted [&_strong]:font-medium [&_strong]:text-ink">{children}</div>
    </details>
  );
}

/** Short answers to "how does this work?", grouped the way the app is. */
export function HelpPage() {
  // Opening /help#install expands that topic.
  useEffect(() => {
    const id = location.hash.split('#').pop();
    const el = id ? document.getElementById(id) : null;
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ block: 'start' });
    }
  }, []);

  return (
    <div className="space-y-5">
      <Link to="/more" className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-label font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageTitle subtitle="Tap a question to open it.">Help & guide</PageTitle>

      <section>
        <h2 className="mb-2 px-0.5 text-label font-semibold text-muted">Books and sharing</h2>
        <Card className="overflow-hidden">
          <Topic title="What is a book?">
            <p>A book holds one set of money: a household, your parents' expenses, a trip. Each has its own categories, budget, members and currency. Switch books from the name at the top.</p>
            <p><strong>Personal</strong> is private to you and can't be shared. To share with family, create a new book and invite them.</p>
          </Topic>
          <Topic title="Who can do what (roles)">
            <p><strong>Owner</strong>: everything, including deleting the book or handing it to someone else.</p>
            <p><strong>Admin</strong>: manages members, categories and book settings, and edits everything.</p>
            <p><strong>Editor</strong>: adds and edits anyone's entries, plans the budget, exports and imports.</p>
            <p><strong>Contributor</strong>: adds entries and edits only their own.</p>
            <p><strong>Viewer</strong>: sees everything, changes nothing.</p>
          </Topic>
          <Topic title="Inviting someone">
            <p>Members → Invite makes a link that works once and expires in 7 days. You can lock it to their phone number. They create their account from the link.</p>
          </Topic>
          <Topic title="Deleted something by mistake?">
            <p>Deleted transactions stay in <strong>Settings → Recently deleted</strong> for 30 days, and the toast right after deleting has an Undo. A deleted book can be restored by its owner from the book menu for 30 days.</p>
          </Topic>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 px-0.5 text-label font-semibold text-muted">Budget</h2>
        <Card className="overflow-hidden">
          <Topic title="How the budget works">
            <p>Enter the month's expected income and give it jobs: an amount for each category. Whatever isn't given a job counts as saved. The plan carries on to the next month by itself until you change it.</p>
            <p>Every expense counts against its category; the Budget tab shows what's left and warns when a category is close to or over its amount (you choose when in Book settings).</p>
          </Topic>
          <Topic title="Sections: bills, spending and savings">
            <p>Each section is tracked one of three ways. <strong>Bills</strong> are paid once a month (paid or due). <strong>Spending</strong> is drawn down day by day, with a pace marker. <strong>Savings</strong> count as money saved, not spent.</p>
            <p>Rename sections, add your own (for example "EMIs & loans" tracked like bills) and reorder them from <strong>Budget → Arrange</strong>.</p>
          </Topic>
          <Topic title="Safe to spend today">
            <p>What's left across your spending categories, divided by the days left in the month. Bills and savings aren't included.</p>
          </Topic>
          <Topic title="Paid mid-month? Salary-day months">
            <p>In <strong>Book settings → Budget month starts on</strong>, pick your salary day. With the 5th, "November" runs from 5 November to 4 December: a budget month is named after the month it starts in, like a salary. Every screen follows it.</p>
          </Topic>
          <Topic title="Carrying unspent money over">
            <p>Turn on <strong>Carry over to next month</strong> in a spending category's budget settings. What's left at the month's end is added to next month; going over takes it off. It counts from the month you switch it on.</p>
          </Topic>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 px-0.5 text-label font-semibold text-muted">Adding entries</h2>
        <Card className="overflow-hidden">
          <Topic title="Repeating entries (rent, salary, EMIs)">
            <p>Set them up in <strong>Settings → Repeating entries</strong>, or tick repeat when adding. They can come round monthly, every few months, or yearly, and stop after a number of payments. When one is due, the Overview offers to add it; nothing is added without you.</p>
          </Topic>
          <Topic title="Tags, who it was for, split, favourites">
            <p>Tap the sliders button on the Add screen. <strong>Tags</strong> group entries across categories (a trip, office expenses). <strong>For</strong> notes whose expense it was. <strong>Split</strong> turns one bill into several entries in different categories. <strong>Favourites</strong> fill in an entry you add often in one tap.</p>
          </Topic>
          <Topic title="Fixing many entries at once">
            <p>On Transactions, tap <strong>Select</strong>, tick entries, then change their category, tag them or delete them together.</p>
          </Topic>
          <Topic title="No internet?">
            <p>New entries are saved on your phone and sent when you're back online. They're only added once, even if you press save twice.</p>
          </Topic>
          <Topic id="install" title="Putting the app on your home screen">
            <p><strong>Android (Chrome)</strong>: menu ⋮ → Add to Home screen or Install app.</p>
            <p><strong>iPhone (Safari)</strong>: Share button → Add to Home Screen.</p>
            <p>It then opens like an app, and long-pressing the icon offers "Add expense".</p>
          </Topic>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 px-0.5 text-label font-semibold text-muted">Your data</h2>
        <Card className="overflow-hidden">
          <Topic title="Importing a bank statement">
            <p><strong>Settings → Import transactions</strong> reads a CSV file. Match the columns, choose categories, check the preview, import. Entries already in the book are skipped, and the whole import can be undone.</p>
          </Topic>
          <Topic title="Exporting and backups">
            <p><strong>Export</strong> (Settings, Budget or Transactions) downloads the budget, transactions or everything, for one month, a range or all time, as CSV, Excel or a JSON backup. A JSON backup can be restored as a new book from the book menu.</p>
          </Topic>
          <Topic title="What's stored and who sees it">
            <p>Your name, phone number, optional email, and a scrambled (hashed) password. Members of a book see its entries and each other's names; only owners and admins see members' full phone numbers.</p>
            <p>Every change in a book is listed in its Activity log, kept for a year. The app lock PIN never leaves your phone.</p>
          </Topic>
          <Topic title="Forgot your password?">
            <p>Use one of the recovery codes you saved (Sign in → Forgot password). Lost them too? The person who set up the app can make you a one-time reset link from <strong>Settings → Users</strong>.</p>
          </Topic>
          <Topic title="Leaving or deleting your account">
            <p><strong>Settings → Your data</strong> lets you download everything about you, or delete your account. Books only you use are deleted with it; entries you added to shared books stay.</p>
          </Topic>
        </Card>
      </section>
    </div>
  );
}
