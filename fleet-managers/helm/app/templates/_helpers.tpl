{{- define "app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "app.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "app.labels" -}}
app.kubernetes.io/name: {{ include "app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
ssp.platform/tenant: {{ .Values.tenant.id | quote }}
ssp.platform/domain: {{ .Values.tenant.domain | quote }}
ssp.platform/department: {{ .Values.tenant.department | quote }}
ssp.platform/cost-center: {{ default "platform-eng" .Values.tenant.costCenter | quote }}
ssp.platform/product: {{ default "ssp-tenant-workload" .Values.tenant.product | quote }}
ssp.platform/environment: {{ default "shared-prod" .Values.tenant.environment | quote }}
ssp.platform/service-id: {{ .Values.ssp.serviceId | quote }}
ssp.platform/revision-id: {{ .Values.ssp.revisionId | quote }}
{{- end -}}

{{- define "app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "app.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "app.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
