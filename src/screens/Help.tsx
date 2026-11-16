import { Header, Section } from '../ui/components';

export function Help() {
  return (
    <div className="screen">
      <Header title="How to use" backTo="/more" />
      <Section title="1. Install before you travel">
        <ol className="small">
          <li>
            <b>iPhone:</b> open the app link in <b>Safari</b> → Share → <b>Add to Home Screen</b>. Always open it from the home-screen icon.
          </li>
          <li>Open it once while online, then switch on airplane mode and check it still opens.</li>
          <li>More → Settings → Cloud sync: sign in with the same account as the Yiwu app.</li>
        </ol>
      </Section>
      <Section title="2. At each booth (≈ 1 minute)">
        <ol className="small">
          <li>Tap the big ＋. Note the company ID (e.g. BE-014) — you can write it on the business card.</li>
          <li>🪪 Business card: photograph the front and back.</li>
          <li>🏪 Booth &amp; products: photograph the booth, products and catalogue pages.</li>
          <li>Tap the bearing types they supply (several allowed), give stars and write a note.</li>
          <li>Type company, WeChat, WhatsApp. The hall is copied from the previous booth; just change the booth number.</li>
          <li>If you want to see the factory: add the factory address and tick “Add to my factory visit list”.</li>
        </ol>
        <div className="small">Everything saves automatically on the phone — no internet needed.</div>
      </Section>
      <Section title="3. After the exhibition">
        <ul className="small">
          <li>More → Factory visits: your factories grouped by city, with Maps, copy-address and a “Visited” tick.</li>
          <li>Compare prices, complete “To complete later” records, set follow-ups.</li>
          <li>Every evening: Your copies → Save now (iCloud Drive) and Excel.</li>
        </ul>
      </Section>
      <Section title="Reinstalled the app, or a new phone?">
        <ol className="small">
          <li>Open the app link in Safari → Share → Add to Home Screen.</li>
          <li>More → Settings → Cloud sync → Sign in. Your companies and photos download automatically.</li>
          <li>No cloud? Settings → Restore from your latest backup .zip.</li>
        </ol>
      </Section>
      <Section title="Good to know">
        <ul className="small">
          <li>Ratings, supplier type and notes are your own observations.</li>
          <li>“Open in Maps” uses Apple Maps, which works in mainland China.</li>
          <li>This app and the Yiwu app are separate: separate icons, separate data and backups, same cloud account.</li>
        </ul>
      </Section>
    </div>
  );
}
