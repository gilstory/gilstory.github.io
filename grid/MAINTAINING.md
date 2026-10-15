# 그리드 현황 웹앱 — 갱신 절차 (Claude 관리용)

웹앱(`index.html`)은 화면만 담당하고, 모든 기록은 `data.json` 하나에 있습니다.
## '현황 보기' 버튼 (2026-10-15부터)
- 데스크톱 앱(바탕화면 '하이닉스 그리드 현황' → `클로드 코워크\클로드 코드\하이닉스_그리드현황\그리드현황.pyw`)에서 누르면
  같은 폴더의 `grid_sync.py`가 PC의 kiwoomcli(Claude 키움 확장, profile `kiwoom5531`, 조회 전용)로 계좌를 조회해
  아래 '갱신 순서'를 자동 수행하고, GitHub API(`gh auth token`)로 `grid/data.json`을 커밋한 뒤 결과를 화면에 바로 그립니다.
- 일반 브라우저에서 누르면 예전처럼 `data.json`만 다시 불러옵니다.
- 자동 배정 규칙: 봇 매수 = 보유 최심 차수 + 1 (매직스플릿은 직전 차수 매수가 ÷ 1.05에 주문, 갭 하락 시 시가 부근 체결),
  봇 매도 = 수량 같고 MS 매수가×1.1 ≤ 체결가인 차수 중 가장 깊은 차수. 수동 체결은 배정하지 않고 log에 '확인 필요'.
- Claude는 log의 '확인 필요' 항목만 사용자와 확인해 손으로 고칩니다. 각 trade에는 `ord`(키움 주문번호)가 붙어 중복 기록을 막습니다.

## 갱신 순서
1. 키움 그리드 계좌 조회(조회 전용 kiwoom_query, profile `kiwoom5531`)
   - 잔고: `domestic accounts holdings` (basis individual, exchange KRX) → 0193T0 보유수량·매입금액·평균단가·현재가·평가손익
   - 현금: `domestic accounts cash` (cash-basis normal) → 주문가능금액
   - 체결: `domestic accounts order-fill-detail` (date=그날, order=order, asset-kind=all, side=all, code=0193T0, exchange=ALL) → 주문 단위 체결가·수량·시간·통신구분(오픈API=봇, 영웅문=수동)
   - 실현손익: `domestic accounts realized-profit-period-stock` (code=0193T0) → 매도 건별 손익·수수료
   - 미체결: order-fill-detail with fill-status=open
2. `data.json` 갱신
   - trades 끝에 새 체결 추가 (date, time, side, tier, price, qty, fee, pl, route, note) — 시간순 유지
   - 봇 매수: 보유 최심 차수 + 1 = n (설계가 근사 방식은 갭 하락 때 틀려서 폐지) → hold[n] = {qty, ms: 체결가, real: 체결가, date}
   - 봇 매도: 보유 차수 중 수량이 같고 MS 매수가×1.1 ≤ 체결가인 차수 → hold에서 제거, sells에 [date, n, qty, 체결가, ms, null, real, fee, 키움손익] 추가
   - 수동 체결: 사용자가 미리 알려 준 배정(예: 1~4차 채우기)이 있으면 그대로, real은 수량 가중평균. 없으면 배정하지 말고 log에 "확인 필요" 기록 후 사용자에게 알림
   - account, price, asOf, updatedAt, log 갱신
3. 검증: hold 수량 합계 = 키움 보유수량, trades 누적 = 키움 보유수량. 다르면 추측해서 맞추지 말고 log와 사용자 메시지로 보고
4. 배포: 클라우드에서 만든 data.json → 사용자 PC의 Claude outputs 폴더로 커밋 → PC에서 `%TEMP%\ghp_grid` 저장소에 복사 → `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`
