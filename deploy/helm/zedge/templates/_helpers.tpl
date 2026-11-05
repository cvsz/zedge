{{- define "zedge.name" -}}{{ .Chart.Name }}{{- end -}}
{{- define "zedge.fullname" -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}{{- end -}}
{{- define "zedge.labels" -}}
app.kubernetes.io/name: {{ include "zedge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}
{{- define "zedge.selector" -}}
app.kubernetes.io/name: {{ include "zedge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
