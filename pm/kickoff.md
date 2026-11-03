# RevolutReader — Kickoff projektu

> **K čemu tento dokument slouží:** výchozí zadání projektu. Na jeho základě další session vytvoří `pm/roadmap.md` a `pm/progress.md`, kterými se bude řídit celý vývoj. Dokument popisuje **co** a **proč**. **Jak** se rozhodne až v jednotlivých krocích roadmapy.
>
> **Značení:** **Rozhodnuto** = platí. **Předpoklad** = výchozí volba, kterou je třeba potvrdit. **Otevřené** = rozhodne se později (viz [kap. 10](#10-otevřené-otázky)).
>
> Datum: 2026-11-03 (aktualizováno 2026-11-04)

---

## 1. Kontext

Dcera je v zahraničí a s mým svolením platí mojí kartou k jednomu konkrétnímu účtu u Revolutu. Potřebuje vidět, kolik na účtu zbývá a jaké platby proběhly.

Původní plán byl, že si nainstaluje aplikaci Revolut a přihlásí se do ní mým účtem. To ale nevyšlo: aplikace vyžaduje ověření obličejem a dcera to zkoušela až v zahraničí, kde nejsem s ní.

## 2. Cíl

Jednoduchá webová aplikace (PWA), ve které dcera uvidí **zůstatek a transakce** na tomto jednom účtu, **pouze pro čtení**, a dostane **push notifikaci**, když se na účtu něco změní.

- **Doba provozu:** cca 2 měsíce.
- **Hlavní priorita je rychlost dodání.** Aplikace je záměrně minimální a nemá nic navíc.
- **Proč PWA:** kvůli push notifikacím a instalaci na mobil.

## 3. Rozsah

**V rozsahu**

- 3 use casy: **Přihlášení**, **Detail účtu** a **Push notifikace o změnách na účtu**.
- Malý pevný okruh předem povolených uživatelů: já, dcera a testovací účty.
- 1 účet u Revolutu, napojený přes Enable Banking.

**Mimo rozsah**

- Jakékoli zápisové operace (platby, převody, správa karty).
- Registrace nových uživatelů a přihlášení kohokoli mimo předem povolené účty.
- Přihlášení jinými než Microsoft účty (např. Apple).
- Další účty nebo banky.
- Cokoli nad rámec tří výše uvedených use casů.

## 4. Uživatelé a přístup

| Uživatel | Role | Typ účtu |
|---|---|---|
| Já (vlastník) | jednorázové nastavení, zároveň běžný uživatel | Microsoft account |
| Dcera | hlavní uživatelka, jen čtení | Microsoft account |
| Testovací účty | ověřování během vývoje | Microsoft account |

- Přihlášení přes **Microsoft Entra ID** osobním Microsoft accountem.
- Povolené účty jsou **určené předem**. Mechanismus je otevřený: buď whitelist e-mailových adres v repozitáři, nebo pozvánky v Entra ID (viz [otázka 1](#10-otevřené-otázky)).
- Dcera dostane odkaz, přihlásí se a může aplikaci rovnou používat. Na její straně nejsou žádné další kroky (registrace, čekání na schválení).
- Kdokoli jiný je odmítnut. Aplikace zobrazuje bankovní data, takže přístup musí být striktně omezen na povolené účty.

## 5. Use casy

### UC1 — Přihlášení

- Nepřihlášený uživatel se přihlásí svým Microsoft účtem.
- Projde pouze předem povolený účet.
- Po přihlášení se zobrazí Detail účtu.

### UC2 — Detail účtu

- **Záhlaví:** aktuální zůstatek účtu.
- **Pod ním:** scrollovatelný seznam transakcí.
- Data se načítají z Revolutu přes Enable Banking. Backend slouží jako proxy.

### UC3 — Push notifikace o změnách na účtu

- Uživatel v aplikaci povolí notifikace.
- Backend pravidelně (např. 1× za hodinu) zjistí stav účtu.
- Pokud se od poslední kontroly něco změnilo, pošle push notifikaci uživatelům, kteří notifikace povolili.

## 6. Architektura

```
PWA (React) ──── přihlášení ────▶ Entra ID
  │       ▲
  │ HTTPS │ Web Push
  │ token │ (přes push službu prohlížeče)
  ▼       │
Backend (.NET 11) ────▶ Enable Banking API ────▶ Revolut
  ├─ API: zůstatek, transakce
  ├─ job (např. 1× za hodinu): kontrola změn → push notifikace
  ├──▶ Cosmos DB   (poslední známý stav účtu, odběry notifikací)
  └──▶ Key Vault   (secrets)
```

- **Backend má dvě části:**
  - **API pro čtení:** 1–2 endpointy (zůstatek, transakce), které předávají data z Enable Banking.
  - **Job pro notifikace:** pravidelně načte stav účtu, porovná ho s posledním uloženým a při změně odešle Web Push.
- **Jen čtení:** vůči bance backend volá výhradně čtecí operace.
- **Napojení Enable Banking na můj Revolut účet** provedu jednou ručně.
- **Databáze:** kvůli notifikacím je potřeba jednoduché úložiště, Cosmos DB ve free tieru. Předběžně v ní bude poslední známý stav účtu (pro detekci změn) a odběry push notifikací.
- **Secrets** jsou výhradně v Azure Key Vault, nikdy v repozitáři. Patří sem např. přístup k Enable Banking a privátní VAPID klíč pro Web Push.
- **Konfigurace** je běžně v repozitáři (appsettings). Pokud by bylo potřeba ji měnit za běhu, použije se Azure App Configuration. **Key Vault je jen pro secrets.**
- **Nasazení:** jeden Docker kontejner na Azure App Service.

## 7. Technologie

| Oblast | Volba | Stav |
|---|---|---|
| Frontend | React + Vite + TypeScript, PWA, Tailwind CSS, Radix Primitives | Rozhodnuto |
| Backend | .NET 11 (ASP.NET Core) | Rozhodnuto |
| Bankovní konektivita | [Enable Banking](https://enablebanking.com/) API → Revolut | Rozhodnuto |
| Autentizace | Microsoft Entra ID, předem povolené Microsoft accounty | Rozhodnuto; mechanismus povolení otevřený |
| Notifikace | Web Push (PWA) | Rozhodnuto |
| Secrets | Azure Key Vault (výhradně secrets) | Rozhodnuto |
| Konfigurace | appsettings v repozitáři; dynamická konfigurace jen v případě potřeby přes Azure App Configuration | Rozhodnuto |
| Databáze | Cosmos DB (free tier), potřeba vyplývá z notifikací | Předpoklad |
| Hosting | Azure App Service (Web App for Containers), Docker | Rozhodnuto |
| Lokální vývoj | .NET Aspire | Rozhodnuto |
| Repozitář a CI/CD | GitHub, deploy na Azure přes GitHub Actions | Rozhodnuto |
| Testy | TDD + BDD; Testcontainers tam, kde je potřeba (s databází pravděpodobně ano) | Rozhodnuto / Předpoklad |

## 8. Způsob vývoje

- **Spec-driven development** přes OpenSpec, kombinovaný s **test-driven** a **behavior-driven development**.
- Vývoj probíhá po **OpenSpec změnách**. Každá je dimenzovaná tak, aby ji **jedna session zvládla celou**, od návrhu přes implementaci po archivaci.
- **Jazyky:** UI česky; kód anglicky; specifikace a commity anglicky.
- Pravidla (styl kódu, workflow, konvence pro TDD a BDD) vzniknou ve [Fázi 0](#93-fáze-0--knowledge-base-a-best-practices) jako knowledge base projektu, ještě před prvním řádkem kódu.

## 9. Podklady pro roadmapu

### 9.1 Výstupy

- **`pm/roadmap.md`:** seznam kroků (manuálních i vývojových), jejich pořadí a závislosti. Kroky **nejsou detailně specifikované**. Mají jen každé další session dát jasno, co je jejím úkolem.
- **`pm/progress.md`:** průběžný stav jednotlivých kroků.

### 9.2 Typy kroků

- **Manuální kroky** dělám já. Claude mě jimi provede krok za krokem a řekne mi, **co, kde a jak** nastavit.
- **Vývojové kroky:** každý odpovídá jedné OpenSpec změně.

### 9.3 Fáze 0 — Knowledge base a best practices

První úkol pro agenta, ještě před jakýmkoli kódem.

- **Cíl:** sepsat knowledge base a best practices projektu: styl kódu, workflow, TDD, BDD apod.
- **Agent nerozhoduje za mě.** Vyzve mě k rozhodnutím, předloží mi možnosti a nechá se mnou řídit.
- **Zdroje, na které agenta nasměruji:**
  - jiný můj projekt, kde už mám velkou část best practices / „software factory“ sepsanou (cestu dodám),
  - konkrétní Claude session, ve které jsem řešil TDD a BDD a ze které chci převzít znalosti (odkaz dodám).

### 9.4 Manuální kroky (předběžně)

| Oblast | Co je potřeba |
|---|---|
| Enable Banking | založení účtu, registrace aplikace, jednorázové propojení s mým Revolut účtem |
| Azure | prvotní nastavení prostředků (App Service, Key Vault, Cosmos DB aj.), uložení secrets |
| Entra ID | registrace aplikace, povolení účtů (dcera, testovací účty) podle zvoleného mechanismu |
| GitHub | vytvoření repozitáře na GitHubu, propojení GitHub Actions s Azure |
| Předání | poslání odkazu dceři, ověření, že se přihlásí, vidí data a dostává notifikace |

### 9.5 OpenSpec změny (předběžně)

Platí pravidlo: **nejdřív základy projektu, potom konkrétní use casy a endpointy.**

1. **Backend: založení projektu.** Solution, Aspire, testovací infrastruktura.
2. **Frontend: založení projektu.** Vite + React + TypeScript, Tailwind, Radix, PWA, testovací infrastruktura.
3. **Adaptér pro Enable Banking.**
4. **API:** endpointy pro zůstatek a transakce, včetně autorizace.
5. **Frontend:** přihlášení a detail účtu.
6. **Nasazení:** Docker image a GitHub Actions → Azure. *(Doplněno: vyplývá z požadavku na deploy přes GitHub Actions. Může být i součástí základů.)*
7. **Push notifikace.** Na backendu periodická kontrola účtu, detekce změn, uložení stavu a odběrů (Cosmos DB) a odesílání Web Push. Na frontendu povolení notifikací a jejich příjem v service workeru. *(Pravděpodobně rozdělit na backend a frontend.)*

Session tvořící roadmapu může změny dělit nebo slučovat tak, aby každá odpovídala jedné session.

**Doporučení k pořadí:** notifikace až po nasazení základní verze (zůstatek a transakce), aby dcera viděla data co nejdřív.

**Závislosti na manuálních krocích:**

- Adaptér lze vyvíjet proti mockům, ale ověření proti skutečnému API vyžaduje hotové nastavení Enable Banking.
- Přihlášení vyžaduje registraci aplikace v Entra ID.
- Nasazení vyžaduje nastavení Azure a propojení s GitHubem.
- Notifikace vyžadují databázi a VAPID klíče uložené v Key Vaultu.

### 9.6 Ukončení provozu *(návrh, doplněno)*

Po skončení dvouměsíčního období:

- zrušit souhlas (consent) v Enable Banking,
- odebrat přístup povoleným účtům,
- smazat prostředky v Azure, včetně databáze s uloženými daty účtu.

## 10. Otevřené otázky

Rozhodnou se ve Fázi 0 nebo v příslušné OpenSpec změně.

1. **Mechanismus povolení účtů:** whitelist e-mailových adres v repozitáři, nebo pozvánky (hosté) v Entra ID. Pozvánky byly původně zavrženy nejspíš kvůli tehdy zvažovanému přihlašování Apple účtem, od kterého se ustoupilo, takže jsou znovu ve hře. U whitelistu počítat s tím, že e-mailové adresy uvidí každý, kdo vidí do repozitáře.
2. **Tok autentizace:** SPA s MSAL a bearer tokenem, nebo BFF s cookie.
3. **Hostování frontendu:** předpokládá se jeden kontejner, ve kterém backend servíruje build frontendu. Potvrdit.
4. **Hosting jobu, registry a náklady:** hodinový job uvnitř App Service vyžaduje zapnuté Always On, které ve Free tarifu není. Alternativou je např. Azure Functions s časovým triggerem. Dále GitHub Container Registry, nebo Azure Container Registry, a tarif App Service.
5. **Enable Banking** *(riziko)*: platnost souhlasu (vydrží celé 2 měsíce, nebo bude nutné ho obnovit?) a cenový plán pro osobní použití. Ověřit.
6. **Limity dotazů na banku** *(riziko, může ovlivnit návrh notifikací)*: PSD2 omezuje počet dotazů bez přítomnosti majitele účtu (typicky 4× denně), zatímco hodinová kontrola znamená 24 dotazů denně. Ověřit, jak to platí přes Enable Banking pro Revolut, a podle toho upravit frekvenci kontrol nebo práci s uloženými daty (cache).
7. **Transakce:** kolik historie zobrazit, stránkování nebo nekonečný scroll, jaké údaje u transakce ukázat (datum, částka, protistrana, popis…).
8. **Obsah notifikací:** co přesně je „změna“ (nová transakce, změna zůstatku), co notifikace obsahuje (částky a obchodníci budou vidět i na zamčené obrazovce) a komu se posílá.
9. **Push na iOS** *(riziko)*: pokud má dcera iPhone, Web Push funguje jen u PWA přidané na plochu (iOS 16.4+). Ověřit, jaký telefon dcera má.
10. **Rozsah PWA:** stačí instalace na mobil a notifikace, nebo je potřeba i offline režim?
