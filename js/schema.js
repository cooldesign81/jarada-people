// 직원 데이터 항목 정의 (상세 화면, 내보내기, 백업이 함께 사용)
export const PERSONAL_FIELDS = [
  { key: "address",          label: "주소", half: true },
  { key: "bankAccount",      label: "계좌번호" },
  { key: "guardianName",     label: "보호자 성명" },
  { key: "guardianRelation", label: "보호자와의 관계" },
  { key: "guardianPhone",    label: "보호자 연락처" },
  { key: "eduStartDate",     label: "교육시작일", type: "date" },
  { key: "workStartDate",    label: "근로시작일", type: "date" },
  { key: "insuranceRegDate", label: "4대보험 등록일", type: "date" },
  { key: "resignDate",       label: "퇴사일", type: "date" },
];
// 서류: 공개서류는 지점 관리자도 열람, 비공개서류는 대표만 열람 (storage.rules 와 같이 바꿀 것)
export const PUBLIC_DOCS = [
  { key: "resume", label: "이력서" }, { key: "portfolio", label: "포트폴리오" },
  { key: "criminalRecord", label: "범죄기록조회서" }, { key: "diploma", label: "졸업증명서" },
];
export const SECRET_DOCS = [
  { key: "residentCopy", label: "주민등록등본" }, { key: "bankbookCopy", label: "통장사본" },
  { key: "businessRegistration", label: "사업자등록확인서" }, { key: "employmentInsuranceDoc", label: "고용보험 관련서류" },
];
export const DEFAULT_REQUIRED_DOCS = ["resume", "criminalRecord", "diploma", "residentCopy", "bankbookCopy"];
export const COMP_FIELDS = [
  ["baseSalary", "기본급"], ["mealAllowance", "식대"],
  ["additionalLabel1", "추가급여1 항목"], ["additionalSalary1", "추가급여1 금액"],
  ["additionalLabel2", "추가급여2 항목"], ["additionalSalary2", "추가급여2 금액"],
  ["additionalLabel3", "추가급여3 항목"], ["additionalSalary3", "추가급여3 금액"],
  ["incentiveThreshold", "인센티브 기준"], ["incentiveAmount", "인센티브 금액"], ["otherSalary", "기타 급여"], ["memo", "급여 메모"],
];
export const AUDIT_ACTIONS = {
  view_sensitive: "민감정보 조회", rrn_save: "주민번호 저장", comp_save: "급여 수정", personal_save: "개인정보 수정",
  file_upload: "파일 업로드", file_download: "파일 다운로드", file_delete: "파일 삭제",
  emp_create: "직원 등록", emp_update: "직원 수정", emp_trash: "직원 휴지통 이동", emp_restore: "직원 복원", emp_purge: "직원 완전 삭제",
  branch_save: "지점 변경", bulk_import: "일괄 등록", export: "엑셀 내보내기", backup: "전체 백업", settings_change: "설정 변경", rrn_back_purge: "주민번호 뒷자리 일괄 삭제",
  link_create: "등록 링크 발급", link_revoke: "등록 링크 폐기",
  leave_request: "휴가 신청", leave_register: "휴가 대리 등록", leave_approved: "휴가 승인", leave_rejected: "휴가 반려", leave_cancelled: "휴가 취소 처리", leave_cancel: "휴가 신청 취소", leave_attach: "예비군 서류 첨부", leave_attach_delete: "예비군 서류 삭제", leave_attach_view: "예비군 서류 열람",
  annual_adjust: "연차 조정", event_create: "일정 등록", event_update: "일정 수정", event_delete: "일정 삭제",
  emp_bulk_change: "직원 일괄 변경", notice_create: "공지 작성", notice_update: "공지 수정", notice_delete: "공지 삭제",
  birth_fill: "생년월일 일괄 채우기", workstart_fill: "근로시작일 일괄 채우기", company_leave_apply: "회사 지정 휴가 연차 차감", company_leave_revoke: "회사 지정 휴가 차감 취소", paylock_set: "급여 열람 비밀번호 설정", paylock_change: "급여 열람 비밀번호 변경", paylock_reset: "급여 열람 비밀번호 초기화", paylock_fail: "급여 열람 비밀번호 연속 실패",
  payslip_upload: "명세서 업로드", payslip_view: "명세서 열람·다운로드", payslip_delete: "명세서 삭제", payslip_edit: "명세서 종류·월 수정", perms_change: "권한 설정 변경", role_relink: "내 계정 연결 변경", labor_view: "인건비 조회", payslip: "급여 명세서 발급", contract_draft: "근로계약서 초안 발급",
  cert_issue: "증명서 발급", record_add: "인사 기록 추가", record_delete: "인사 기록 삭제",
  notice_create: "공지 등록", notice_delete: "공지 삭제", contract_issue: "계약서 작성", payslip_issue: "급여 명세서 작성",
};

// ---------- 등급별 권한 설정 (관리 → 권한 설정) ----------
// levels: 설정에서 켜고 끌 수 있는 등급 / def: 설정이 없을 때의 기본값 (firestore.rules·storage.rules 의 기본값과 같아야 함)
// 최고관리자는 항상 모든 권한을 가지며 설정 대상이 아니다. 사원은 부여할 수 없다.
export const PERM_LEVELS = [["hr", "대표이사"], ["principal", "원장"], ["admin", "부원장"], ["manager", "실장"], ["lead", "팀장"]];
const ALL_MGR = ["hr", "principal", "admin", "manager", "lead"];
export const PERMS = [
  { key: "comp", label: "급여 정보", desc: "급여 조회·수정과 변경 이력, 급여 명세서·근로계약서·퇴직금 예상, 지점별 인건비", levels: ["hr"], def: [] },
  { key: "rrnBack", label: "주민번호 뒷자리 조회", desc: "직원이 입력한 주민등록번호 뒤 7자리를 볼 수 있음", levels: ["hr"], def: [] },
  { key: "secDocs", label: "비공개서류·인사평가 파일", desc: "주민등록등본·통장사본 등 비공개서류와 인사평가·기타 파일의 열람·업로드·삭제", levels: ["hr"], def: [] },
  { key: "audit", label: "감사 로그 열람", desc: "누가 언제 민감정보를 열었는지 보는 기록", levels: ["hr"], def: ["hr"] },
  { key: "trash", label: "직원 삭제(휴지통)·복원", desc: "직원을 휴지통으로 옮기고 되살림 (‘직원 등록·수정’ 권한도 필요). 완전 삭제는 최고관리자만", levels: ["hr"], def: ["hr"] },
  { key: "empWrite", label: "직원 등록·수정·일괄 등록", desc: "직원 기본 정보, 소속·등급·상태 변경, 일괄 등록 (원장·부원장은 소속 지점 직원만)", levels: ["hr", "principal", "admin"], def: ["hr", "principal", "admin"] },
  { key: "leaveApprove", label: "휴가 승인·반려", desc: "휴가 신청 처리. 실장·팀장은 소속 지점 신청만", levels: ALL_MGR, def: ALL_MGR },
  { key: "noticeWrite", label: "공지 작성·수정·삭제", desc: "대표이사는 전체·지점별, 원장·부원장은 소속 지점 공지만", levels: ["hr", "principal", "admin"], def: ["hr", "principal", "admin"] },
];
