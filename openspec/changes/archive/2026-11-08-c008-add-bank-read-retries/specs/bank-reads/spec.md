## ADDED Requirements

### Requirement: Retrying a failed request
A read for a present user SHALL repeat a request up to three times when it fails in a way that reads as bank unavailable, and SHALL use the first answer that does not. The configured request timeout SHALL cover a request with all its repeats; a request that runs into it SHALL NOT be repeated. A transactions read SHALL repeat only the failed page. An unattended read SHALL NOT repeat any request, and no request that ends rate limited, access expired or as an error SHALL be repeated.

#### Scenario: A one-off bank error is retried and the read succeeds
- **GIVEN** the bank reports an error of its own for the first request, then an available balance of 1234.56 EUR
- **WHEN** the balance is read for a present user
- **THEN** the result is the balance 1234.56 EUR
- **AND** the bank received 2 requests

#### Scenario: A connection that breaks once is retried and the read succeeds
- **GIVEN** the connection to the bank breaks while the answer to the first request comes in, then the bank reports an available balance of 1234.56 EUR
- **WHEN** the balance is read for a present user
- **THEN** the result is the balance 1234.56 EUR
- **AND** the bank received 2 requests

#### Scenario: A bank error that persists is tried four times, then reads as bank unavailable
- **GIVEN** the bank reports an error of its own for every request
- **WHEN** the balance is read for a present user
- **THEN** the result is bank unavailable
- **AND** the bank received 4 requests

#### Scenario: A failure on a later page retries only that page
- **GIVEN** the bank lists 25 transactions since 2026-10-06, in three pages, and reports an error of its own for the first request for the second page
- **WHEN** the transactions from 2026-10-06 are read for a present user
- **THEN** the result holds all 25 transactions
- **AND** the bank received 4 requests, two of them for the second page

#### Scenario: An unattended read is never retried
- **GIVEN** the bank reports an error of its own for the first request, then an available balance of 1234.56 EUR
- **WHEN** the balance is read unattended
- **THEN** the result is bank unavailable
- **AND** the bank received exactly one request

## MODIFIED Requirements

### Requirement: Bank unavailable
A read SHALL return the failure "bank unavailable", instead of a result, when the bank reports an error or a timeout of its own, when it does not answer within the configured request timeout, or when it cannot be reached, and no repeat is left (Retrying a failed request). A server error without an Enable Banking code, such as a gateway's error page, counts as the bank's own error. Any other failure (a wrong key or account, a rejected request, a success answer that cannot be read) is an error, not a result.

#### Scenario: A bank error reads as bank unavailable
- **GIVEN** the bank reports an error of its own for every request
- **WHEN** the balance is read
- **THEN** the result is bank unavailable

#### Scenario: A bank that answers too slowly reads as bank unavailable
- **GIVEN** the bank answers only after the configured request timeout
- **WHEN** the balance is read for a present user
- **THEN** the result is bank unavailable
- **AND** the bank received exactly one request

#### Scenario: A gateway's error page reads as bank unavailable
- **GIVEN** a gateway in front of the bank answers every request that the service is unavailable, with its own maintenance page, without an Enable Banking error code
- **WHEN** the balance is read
- **THEN** the result is bank unavailable
