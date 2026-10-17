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
  leave_request: "휴가 신청", leave_register: "휴가 대리 등록", leave_approved: "휴가 승인", leave_rejected: "휴가 반려", leave_cancelled: "휴가 취소 처리", leave_cancel: "휴가 신청 취소",
  annual_adjust: "연차 조정", event_create: "일정 등록", event_update: "일정 수정", event_delete: "일정 삭제",
  cert_issue: "증명서 발급", record_add: "인사 기록 추가", record_delete: "인사 기록 삭제",
  notice_create: "공지 등록", notice_delete: "공지 삭제", contract_issue: "계약서 작성", payslip_issue: "급여명세서 작성",
};
