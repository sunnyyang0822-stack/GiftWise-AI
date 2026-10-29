# 阶段 B 逐例结果

所有案例均实际调用公开 validate；原始参数、预期与完整实际响应见同目录 results.json。无开发自测计入本表。

| 检查 | 组别 | 预期状态 | 实际状态 | 实际错误码与路径 | 结果 |
|---|---|---|---|---|---|
| B001_base | T01 | passed | passed | 无 | passed |
| money_allowed_request_0 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_request_1 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_request_2 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_request_3 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_request_4 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_request_5 | T02_T11 | passed | passed | 无 | passed |
| money_reject_request_0 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_1 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_2 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_3 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_4 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_5 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_6 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_7 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_8 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_9 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_10 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_11 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_12 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_13 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_14 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_15 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_16 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_17 | T11 | needs_input | needs_input | INVALID_AMOUNT @ request.budget_amount | passed |
| money_reject_request_18 | T11 | needs_input | needs_input | INVALID_TYPE @ request.budget_amount | passed |
| money_reject_request_19 | T11 | needs_input | needs_input | INVALID_TYPE @ request.budget_amount | passed |
| money_reject_request_20 | T11 | needs_input | needs_input | INVALID_TYPE @ request.budget_amount | passed |
| money_reject_request_21 | T11 | needs_input | needs_input | INVALID_TYPE @ request.budget_amount | passed |
| money_reject_request_22 | T11 | needs_input | needs_input | INVALID_TYPE @ request.budget_amount | passed |
| money_allowed_candidate_0 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_candidate_1 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_candidate_2 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_candidate_3 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_candidate_4 | T02_T11 | passed | passed | 无 | passed |
| money_allowed_candidate_5 | T02_T11 | passed | passed | 无 | passed |
| money_reject_candidate_0 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_1 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_2 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_3 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_4 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_5 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_6 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_7 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_8 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_9 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_10 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_11 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_12 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_13 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_14 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_15 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_16 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_17 | T11 | failed | failed | INVALID_AMOUNT @ candidates[0].estimated_total | passed |
| money_reject_candidate_18 | T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_total | passed |
| money_reject_candidate_19 | T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_total | passed |
| money_reject_candidate_20 | T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_total | passed |
| money_reject_candidate_21 | T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_total | passed |
| money_reject_candidate_22 | T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_total | passed |
| budget_boundary_100.10 | T02 | passed | passed | 无 | passed |
| budget_boundary_100.11 | T02 | failed | failed | OVER_BUDGET @ candidates[0].estimated_total | passed |
| days_reject_request_0 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_1 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_2 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_3 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_4 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_5 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_6 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_request_7 | T04_T11 | needs_input | needs_input | INVALID_TYPE @ request.available_days | passed |
| days_reject_candidate_0 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_1 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_2 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_3 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_4 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_5 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_6 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_reject_candidate_7 | T04_T11 | failed | failed | INVALID_TYPE @ candidates[0].estimated_preparation_days | passed |
| days_boundary_0 | T04 | passed | passed | 无 | passed |
| days_boundary_3 | T04 | passed | passed | 无 | passed |
| days_boundary_4 | T04 | failed | failed | PREPARATION_TOO_LONG @ candidates[0].estimated_preparation_days | passed |
| required_request_recipient_relation | T05_T10 | needs_input | needs_input | MISSING_FIELD @ request.recipient_relation | passed |
| required_request_occasion | T05_T10 | needs_input | needs_input | MISSING_FIELD @ request.occasion | passed |
| required_request_budget_amount | T05_T10 | needs_input | needs_input | MISSING_FIELD @ request.budget_amount | passed |
| required_request_currency | T05_T10 | needs_input | needs_input | MISSING_FIELD @ request.currency | passed |
| required_request_available_days | T05_T10 | needs_input | needs_input | MISSING_FIELD @ request.available_days | passed |
| required_candidate_id | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].id | passed |
| required_candidate_name | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].name | passed |
| required_candidate_description | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].description | passed |
| required_candidate_estimated_total | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].estimated_total | passed |
| required_candidate_currency | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].currency | passed |
| required_candidate_estimated_preparation_days | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].estimated_preparation_days | passed |
| required_candidate_tags | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].tags | passed |
| required_candidate_reason | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].reason | passed |
| required_candidate_fact_refs | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].fact_refs | passed |
| required_candidate_inferences | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].inferences | passed |
| required_candidate_unknowns | T05_T10 | failed | failed | MISSING_FIELD @ candidates[0].unknowns | passed |
| optional_arrays_empty | T05_PM_VAL_001 | passed | passed | 无 | passed |
| empty_tags_position_0 | PM_VAL_001 | failed | failed | INVALID_TYPE @ candidates[0].tags | passed |
| empty_tags_position_1 | PM_VAL_001 | failed | failed | INVALID_TYPE @ candidates[1].tags | passed |
| empty_tags_position_2 | PM_VAL_001 | failed | failed | INVALID_TYPE @ candidates[2].tags | passed |
| array_type_fact_refs_0 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].fact_refs | passed |
| array_type_fact_refs_1 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].fact_refs | passed |
| array_type_fact_refs_2 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].fact_refs | passed |
| array_type_fact_refs_3 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].fact_refs[0] | passed |
| array_type_fact_refs_4 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].fact_refs[0] | passed |
| array_type_fact_refs_5 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].fact_refs[0] | passed |
| array_type_inferences_0 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].inferences | passed |
| array_type_inferences_1 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].inferences | passed |
| array_type_inferences_2 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].inferences | passed |
| array_type_inferences_3 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].inferences[0] | passed |
| array_type_inferences_4 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].inferences[0] | passed |
| array_type_inferences_5 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].inferences[0] | passed |
| array_type_unknowns_0 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].unknowns | passed |
| array_type_unknowns_1 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].unknowns | passed |
| array_type_unknowns_2 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].unknowns | passed |
| array_type_unknowns_3 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].unknowns[0] | passed |
| array_type_unknowns_4 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].unknowns[0] | passed |
| array_type_unknowns_5 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].unknowns[0] | passed |
| array_type_tags_0 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].tags | passed |
| array_type_tags_1 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].tags | passed |
| array_type_tags_2 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].tags | passed |
| array_type_tags_3 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].tags[0] | passed |
| array_type_tags_4 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].tags[0] | passed |
| array_type_tags_5 | T10_T13 | failed | failed | INVALID_TYPE @ candidates[0].tags[0] | passed |
| text_type_name_0 | T10 | failed | failed | INVALID_TYPE @ candidates[0].name | passed |
| text_type_name_1 | T10 | failed | failed | INVALID_TYPE @ candidates[0].name | passed |
| text_type_name_2 | T10 | failed | failed | INVALID_TYPE @ candidates[0].name | passed |
| text_type_name_3 | T10 | failed | failed | INVALID_TYPE @ candidates[0].name | passed |
| text_type_name_4 | T10 | failed | failed | INVALID_TYPE @ candidates[0].name | passed |
| text_type_description_0 | T10 | failed | failed | INVALID_TYPE @ candidates[0].description | passed |
| text_type_description_1 | T10 | failed | failed | INVALID_TYPE @ candidates[0].description | passed |
| text_type_description_2 | T10 | failed | failed | INVALID_TYPE @ candidates[0].description | passed |
| text_type_description_3 | T10 | failed | failed | INVALID_TYPE @ candidates[0].description | passed |
| text_type_description_4 | T10 | failed | failed | INVALID_TYPE @ candidates[0].description | passed |
| text_type_reason_0 | T10 | failed | failed | INVALID_TYPE @ candidates[0].reason | passed |
| text_type_reason_1 | T10 | failed | failed | INVALID_TYPE @ candidates[0].reason | passed |
| text_type_reason_2 | T10 | failed | failed | INVALID_TYPE @ candidates[0].reason | passed |
| text_type_reason_3 | T10 | failed | failed | INVALID_TYPE @ candidates[0].reason | passed |
| text_type_reason_4 | T10 | failed | failed | INVALID_TYPE @ candidates[0].reason | passed |
| text_type_presentation_0 | T10 | failed | failed | INVALID_TYPE @ candidates[0].presentation | passed |
| text_type_presentation_1 | T10 | failed | failed | INVALID_TYPE @ candidates[0].presentation | passed |
| text_type_presentation_2 | T10 | failed | failed | INVALID_TYPE @ candidates[0].presentation | passed |
| text_type_presentation_3 | T10 | failed | failed | INVALID_TYPE @ candidates[0].presentation | passed |
| text_type_presentation_4 | T10 | failed | failed | INVALID_TYPE @ candidates[0].presentation | passed |
| currency_request | T09 | needs_input | needs_input | UNSUPPORTED_CURRENCY @ request.currency | passed |
| currency_candidate | T09 | failed | failed | CURRENCY_MISMATCH @ candidates[0].currency | passed |
| parse_request_0 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_0 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_1 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_1 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_2 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_2 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_3 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_3 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_4 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_4 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_5 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_5 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_6 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_6 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parse_request_7 | T06 | error | error | INVALID_JSON @ request_json | passed |
| parse_candidates_7 | T06 | error | error | INVALID_JSON @ candidates_json | passed |
| parameter_type_request_0 | C1 | needs_input | needs_input | INVALID_TYPE @ request_json | passed |
| parameter_type_request_1 | C1 | needs_input | needs_input | INVALID_TYPE @ request_json | passed |
| parameter_type_request_2 | C1 | needs_input | needs_input | INVALID_TYPE @ request_json | passed |
| parameter_type_request_3 | C1 | needs_input | needs_input | INVALID_TYPE @ request_json | passed |
| root_request_0 | T06_C1 | needs_input | needs_input | INVALID_REQUEST @ request | passed |
| root_request_1 | T06_C1 | needs_input | needs_input | INVALID_REQUEST @ request | passed |
| root_request_2 | T06_C1 | needs_input | needs_input | INVALID_REQUEST @ request | passed |
| root_request_3 | T06_C1 | needs_input | needs_input | INVALID_REQUEST @ request | passed |
| root_request_4 | T06_C1 | needs_input | needs_input | INVALID_REQUEST @ request | passed |
| invalid_utf8_request | C1 | error | error | INVALID_JSON @ request_json | passed |
| parameter_type_candidates_0 | C1 | failed | failed | INVALID_TYPE @ candidates_json | passed |
| parameter_type_candidates_1 | C1 | failed | failed | INVALID_TYPE @ candidates_json | passed |
| parameter_type_candidates_2 | C1 | failed | failed | INVALID_TYPE @ candidates_json | passed |
| parameter_type_candidates_3 | C1 | failed | failed | INVALID_TYPE @ candidates_json | passed |
| root_candidates_0 | T06_C1 | failed | failed | INVALID_TYPE @ candidates | passed |
| root_candidates_1 | T06_C1 | failed | failed | INVALID_TYPE @ candidates | passed |
| root_candidates_2 | T06_C1 | failed | failed | INVALID_TYPE @ candidates | passed |
| root_candidates_3 | T06_C1 | failed | failed | INVALID_TYPE @ candidates | passed |
| root_candidates_4 | T06_C1 | failed | failed | INVALID_TYPE @ candidates | passed |
| invalid_utf8_candidates | C1 | error | error | INVALID_JSON @ candidates_json | passed |
| id_'' | C3 | failed | failed | INVALID_CANDIDATE_ID @ candidates[0].id | passed |
| id_'c4' | C3 | failed | failed | INVALID_CANDIDATE_ID @ candidates[0].id | passed |
| id_'C1' | C3 | failed | failed | INVALID_CANDIDATE_ID @ candidates[0].id | passed |
| id_'c1 ' | C3 | failed | failed | INVALID_CANDIDATE_ID @ candidates[0].id | passed |
| id_' c1' | C3 | failed | failed | INVALID_CANDIDATE_ID @ candidates[0].id | passed |
| id_type_0 | C3 | failed | failed | INVALID_TYPE @ candidates[0].id | passed |
| id_type_1 | C3 | failed | failed | INVALID_TYPE @ candidates[0].id | passed |
| id_type_2 | C3 | failed | failed | INVALID_TYPE @ candidates[0].id | passed |
| id_duplicate | T12_C3 | failed | failed | DUPLICATE_ID @ candidates[1].id | passed |
| id_reordered | C3 | passed | passed | 无 | passed |
| count_0 | T12 | failed | failed | INVALID_CANDIDATE_COUNT @ candidates | passed |
| count_2 | T12 | failed | failed | INVALID_CANDIDATE_COUNT @ candidates | passed |
| count_4 | T12 | failed | failed | INVALID_CANDIDATE_COUNT @ candidates；DUPLICATE_ID @ candidates[3].id | passed |
| count_21 | T12 | failed | failed | INVALID_CANDIDATE_COUNT @ candidates；DUPLICATE_ID @ candidates[3].id；DUPLICATE_ID @ candidates[4].id；DUPLICATE_ID @ candidates[5].id；DUPLICATE_ID @ candidates[6].id；DUPLICATE_ID @ candidates[7].id；DUPLICATE_ID @ candidates[8].id；DUPLICATE_ID @ candidates[9].id；DUPLICATE_ID @ candidates[10].id；DUPLICATE_ID @ candidates[11].id；DUPLICATE_ID @ candidates[12].id；DUPLICATE_ID @ candidates[13].id；DUPLICATE_ID @ candidates[14].id；DUPLICATE_ID @ candidates[15].id；DUPLICATE_ID @ candidates[16].id；DUPLICATE_ID @ candidates[17].id；DUPLICATE_ID @ candidates[18].id；DUPLICATE_ID @ candidates[19].id；DUPLICATE_ID @ candidates[20].id | passed |
| batch_type_0 | T12 | failed | failed | INVALID_TYPE @ candidates | passed |
| batch_type_1 | T12 | failed | failed | INVALID_TYPE @ candidates | passed |
| batch_type_2 | T12 | failed | failed | INVALID_TYPE @ candidates | passed |
| batch_type_3 | T12 | failed | failed | INVALID_TYPE @ candidates | passed |
| unknown_tag_request | C2 | needs_input | needs_input | UNKNOWN_TAG @ request.forbidden_tags[0] | passed |
| tag_type_request | C2 | needs_input | needs_input | INVALID_TYPE @ request.forbidden_tags[0] | passed |
| unknown_tag_candidate | C2 | failed | failed | UNKNOWN_TAG @ candidates[0].tags[0] | passed |
| tag_type_candidate | C2 | failed | failed | INVALID_TYPE @ candidates[0].tags[0] | passed |
| tag_forbidden_normalized | T03_C2 | failed | failed | FORBIDDEN_TAG @ candidates[0].tags[0] | passed |
| tag_known_normalized | C2 | passed | passed | 无 | passed |
| forbidden_term_name | T03 | failed | failed | FORBIDDEN_TERM @ candidates[0].name | passed |
| forbidden_term_description | T03 | failed | failed | FORBIDDEN_TERM @ candidates[0].description | passed |
| forbidden_term_reason | T03 | failed | failed | FORBIDDEN_TERM @ candidates[0].reason | passed |
| forbidden_term_presentation | T03 | failed | failed | FORBIDDEN_TERM @ candidates[0].presentation | passed |
| forbidden_term_inferences | T03 | failed | failed | FORBIDDEN_TERM @ candidates[0].inferences[0] | passed |
| forbidden_term_nfkc_case | T03 | failed | failed | FORBIDDEN_TERM @ candidates[0].description | passed |
| unknown_fact | T10 | failed | failed | UNKNOWN_FACT_REF @ candidates[0].fact_refs[0] | passed |
| duplicate_fact | T12 | needs_input | needs_input | DUPLICATE_ID @ request.facts[2].id | passed |
| fact_shape_0 | T10 | needs_input | needs_input | INVALID_TYPE @ request.facts[0] | passed |
| fact_shape_1 | T10 | needs_input | needs_input | INVALID_TYPE @ request.facts[0].id | passed |
| fact_shape_2 | T10 | needs_input | needs_input | INVALID_TYPE @ request.facts[0].text | passed |
| fact_shape_3 | T10 | needs_input | needs_input | INVALID_TYPE @ request.facts[0].id | passed |
| content_duplicate_pair | C4 | failed | failed | DUPLICATE_CANDIDATE_CONTENT @ candidates[0]；DUPLICATE_CANDIDATE_CONTENT @ candidates[1] | passed |
| content_only_same_name | C4 | passed | passed | 无 | passed |
| content_only_same_description | C4 | passed | passed | 无 | passed |
| text_limit_request_1000 | C6 | passed | passed | 无 | passed |
| text_limit_request_1001 | C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request.notes | passed |
| text_limit_candidate_1000 | C6 | passed | passed | 无 | passed |
| text_limit_candidate_1001 | C6 | failed | failed | LIMIT_EXCEEDED @ candidates[0].description | passed |
| raw_limit_request_32768 | C6 | passed | passed | 无 | passed |
| raw_limit_request_32769 | C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request_json | passed |
| oversize_invalid_not_parsed_request | C1_C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request_json | passed |
| raw_limit_candidates_32768 | C6 | passed | passed | 无 | passed |
| raw_limit_candidates_32769 | C6 | failed | failed | LIMIT_EXCEEDED @ candidates_json | passed |
| oversize_invalid_not_parsed_candidates | C1_C6 | failed | failed | LIMIT_EXCEEDED @ candidates_json | passed |
| list_limit_facts_20 | C6 | passed | passed | 无 | passed |
| list_limit_facts_21 | C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request.facts | passed |
| list_limit_forbidden_tags_20 | C6 | passed | passed | 无 | passed |
| list_limit_forbidden_tags_21 | C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request.forbidden_tags | passed |
| list_limit_forbidden_terms_20 | C6 | passed | passed | 无 | passed |
| list_limit_forbidden_terms_21 | C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request.forbidden_terms | passed |
| list_limit_tags_20 | C6 | passed | passed | 无 | passed |
| list_limit_tags_21 | C6 | failed | failed | LIMIT_EXCEEDED @ candidates[0].tags | passed |
| list_limit_fact_refs_20 | C6 | passed | passed | 无 | passed |
| list_limit_fact_refs_21 | C6 | failed | failed | LIMIT_EXCEEDED @ candidates[0].fact_refs | passed |
| list_limit_inferences_20 | C6 | passed | passed | 无 | passed |
| list_limit_inferences_21 | C6 | failed | failed | LIMIT_EXCEEDED @ candidates[0].inferences | passed |
| list_limit_unknowns_20 | C6 | passed | passed | 无 | passed |
| list_limit_unknowns_21 | C6 | failed | failed | LIMIT_EXCEEDED @ candidates[0].unknowns | passed |
| priority_request_before_candidate | C1 | needs_input | needs_input | MISSING_FIELD @ request.budget_amount；MISSING_FIELD @ candidates[0].reason | passed |
| priority_parse_before_request | C1 | error | error | MISSING_FIELD @ request.occasion；INVALID_JSON @ candidates_json | passed |
| priority_parse_before_limit | C1 | error | error | LIMIT_EXCEEDED @ request_json；INVALID_JSON @ candidates_json | passed |
| priority_both_limits | C1_C6 | needs_input | needs_input | LIMIT_EXCEEDED @ request_json；LIMIT_EXCEEDED @ candidates_json | passed |
| offline_snapshot_before | T07_T08 | failed | failed | OVER_BUDGET @ candidates[0].estimated_total | passed |
| offline_snapshot_success_after | T07_T08 | passed | passed | 无 | passed |
| offline_snapshot_failure_after | T07_T08 | failed | failed | OVER_BUDGET @ candidates[0].estimated_total | passed |
| isolation_no_io | PURE | passed | passed | 无 | passed |
| controlled_execution_failure | T15_local_only | error | error | INTERNAL_ERROR @ $ | passed |
| test_fixed_snapshots_only_change_failed_candidate_amount | 版本/快照一致性 | 断言成立 | 断言成立 | 无 | passed |
| test_hash_0 | 版本/快照一致性 | 断言成立 | 断言成立 | 无 | passed |
| test_hash_1 | 版本/快照一致性 | 断言成立 | 断言成立 | 无 | passed |
| test_hash_2 | 版本/快照一致性 | 断言成立 | 断言成立 | 无 | passed |
| test_hash_3 | 版本/快照一致性 | 断言成立 | 断言成立 | 无 | passed |
| test_review_manifest_has_four_files | 版本/快照一致性 | 断言成立 | 断言成立 | 无 | passed |
