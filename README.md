# Seladevs Invoice Studio

A responsive invoice generator for [Seladevs](https://seladevs.my), built with Next.js, React and TypeScript. Create itemized invoices, preview the A4 document, save drafts, manage clients, export PDF through the browser and install the app for offline use.

## Run locally

Use Node.js 20.9 or newer and npm. From this directory:

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The development server does not register the offline service worker.

## Check and build

```sh
npm run typecheck
npm test
npm run build
npm start
```

The production build creates a static site in `out/`. After Next.js exports the app, `scripts/build-pwa.mjs` derives app icons from the official logo and generates a content-versioned service worker. `npm start` serves that export at [http://localhost:3000](http://localhost:3000).

Run `npm test` again after building to exercise the generated worker in a mocked service-worker environment. Those checks cover the exported precache assets, offline app-shell reloads, cache filling, request filtering and scoped cache cleanup. They skip automatically when `out/sw.js` is absent, as on a fresh checkout. Browser installation and real offline behavior still need the production browser check described below.

Deploy the contents of `out/` to a static host at the domain root. The app has no server API, database or required environment variables. Serve it over HTTPS for installation and service-worker support; localhost is also supported. Keep `sw.js` revalidating rather than giving it a long-lived immutable cache policy.

## Create an invoice

1. Open **Company settings** and enter the legal company name, business address and registration details. The supplied brand defaults are Seladevs, `seladevs.my` and `seladevs@gmail.com`.
2. Add the client, invoice and due dates, optional PO/project reference, services, quantities and rates.
3. Add payment details, notes and agreed terms. MYR is the default; USD and SGD are also available. Tax and discount start at zero and can be set per invoice.
4. Choose **Export PDF**, then select **Save as PDF** in the browser print dialog. Use A4 portrait and disable browser headers and footers. The same dialog can print a paper copy.

Drafts save automatically on the current device, and **Save draft** saves immediately. **My invoices** provides search, status filtering, duplication and deletion. The client list is collected from saved invoice recipients. New invoice numbers follow `INV-YYYY-001` and advance from the highest existing sequence for the current year; invoice numbers remain editable.

Monetary line amounts are rounded to cents before summing. Percentage discounts apply before tax. Payments reduce the balance due. Export validation checks the billing information, dates, line items, amounts and duplicate invoice numbers.

## Local data and backups

Invoices and the company profile are stored in this browser's `localStorage`. They are not uploaded to a server and do not sync across devices, browsers, browser profiles or origins. Clearing site data removes saved records. Private browsing and device storage limits can affect persistence.

Use **Download a backup** or **Export backup** to download a JSON copy containing the invoices and company profile. **Company settings → Import invoices** accepts a Seladevs backup. Store the backup separately if you need recovery or want to transfer records to another device. A PDF is the customer-facing document; a JSON backup preserves editable records.

Storage keys are `seladevs-invoice-studio-v1` and `seladevs-company-v1`. The app displays a storage notice when it cannot save locally.

## Install and work offline

Run the production build and visit once while online so the service worker can finish caching the app. Chrome and Edge can expose an install action in the address bar or browser menu; the in-app **Install app** button uses the browser prompt when available. On iPhone or iPad, open the site in Safari and choose **Share → Add to Home Screen**.

The worker precaches the exported app, JavaScript and CSS chunks, local fonts, logo and icons. Navigation tries the network first and falls back to the cached app; static assets use the cache first. After offline setup completes, editing, local saving and printing remain available without a connection. External website and research links still need a connection. A new production build updates the app cache without deleting invoice data.

To verify offline behavior, serve `out/`, open the app online, allow offline setup to complete, then enable the browser's offline mode and reload. Installation availability depends on the browser and operating system.

## Research and brand sources

The document structure follows practical professional invoicing guidance: clear supplier and buyer details, a unique invoice number, issue and due dates, itemized charges, payment instructions and a prominent amount due. See the [Small Business Commissioner's guide to effective invoicing](https://www.smallbusinesscommissioner.gov.uk/help-and-guidance/all-advice/a-guide-for-effective-invoicing/).

Malaysia's structured invoice fields were checked against the [official MyInvois invoice specification](https://sdk.myinvois.hasil.gov.my/documents/invoice-v1-1/). This app creates ordinary invoices and printable PDFs. It does not submit documents to HASiL or provide government e-Invoice validation. HASiL distinguishes structured XML/JSON e-Invoices from PDF documents in its [general e-Invoice FAQ](https://www.hasil.gov.my/media/0xqitc2t/lhdnm-e-invoice-general-faqs.pdf).

The included logo was fetched from the [official Seladevs logo asset](https://seladevs.my/branding/seladevs-logo.png) and is stored at `public/brand/seladevs-logo.png`. Brand context and contact information came from [seladevs.my](https://seladevs.my). The interface uses the brand red `#df2337`. Seladevs retains its brand and logo rights. App icons are padded derivatives of that supplied logo. DM Sans and Manrope Latin fonts are served locally from `public/fonts/`.
