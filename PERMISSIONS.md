# Macierz uprawnień ról

Źródło: `server/src/permissions.js`. Uprawnienia są egzekwowane po stronie serwera (`requirePermission`), a klient jedynie ukrywa niedostępne akcje.

## Uprawnienia według ról

| Uprawnienie | Opis | Administrator | Kierownik | Pracownik | Gość |
|---|---|:---:|:---:|:---:|:---:|
| `resources:read` | Przeglądanie zasobów | ✔ | ✔ | ✔ | ✔ |
| `resources:create` | Dodawanie zasobów | ✔ | ✔ | ✔ | ✘ |
| `resources:update` | Edycja zasobów | ✔ | ✔ | ✔ | ✘ |
| `resources:delete` | Usuwanie zasobów | ✔ | ✔ | ✘ | ✘ |
| `users:manage` | Zarządzanie użytkownikami (panel administratora) | ✔ | ✘ | ✘ | ✘ |
| `settings:manage` | Ustawienia systemu (polityka haseł, ważność haseł, sesja) | ✔ | ✘ | ✘ | ✘ |

## Operacje a wymagane uprawnienia

| Operacja (API) | Wymagane uprawnienie |
|---|---|
| `GET /api/resources`, `GET /api/resources/types` | `resources:read` |
| `POST /api/resources` | `resources:create` |
| `PUT /api/resources/:id` | `resources:update` |
| `DELETE /api/resources/:id` | `resources:delete` |
| `GET/POST/PUT/PATCH/DELETE /api/admin/users…` | `users:manage` |
| `GET/PUT /api/admin/settings` | `users:manage` |
| Zmiana własnego hasła, profil, wylogowanie | tylko zalogowany użytkownik |

## Zasady dodatkowe

- Rola **Administrator** przysługuje wyłącznie stałemu kontu `ADMIN`; pozostałym użytkownikom można nadać role Kierownik, Pracownik lub Gość.
- Konta `ADMIN` nie można edytować, blokować, usuwać ani resetować jego hasła z panelu (hasło zmienia się w panelu użytkownika lub `npm run reset-admin`).
- Zablokowanie lub reset hasła użytkownika kończy jego aktywne sesje.
- Przy konieczności zmiany hasła (hasło jednorazowe lub wygasłe) dostęp do pozostałych endpointów jest blokowany do czasu zmiany.
