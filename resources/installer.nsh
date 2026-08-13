!macro customInstall
  WriteRegStr HKLM "Software\QuillMesh\Capabilities" "ApplicationName" "QuillMesh"
  WriteRegStr HKLM "Software\QuillMesh\Capabilities" "ApplicationDescription" "A local-first Markdown editor built for people and AI agents"
  WriteRegStr HKLM "Software\QuillMesh\Capabilities\FileAssociations" ".md" "QuillMesh.Markdown"
  WriteRegStr HKLM "Software\QuillMesh\Capabilities\FileAssociations" ".markdown" "QuillMesh.Markdown"
  WriteRegStr HKLM "Software\QuillMesh\Capabilities\FileAssociations" ".mdown" "QuillMesh.Markdown"
  WriteRegStr HKLM "Software\QuillMesh\Capabilities\FileAssociations" ".mkd" "QuillMesh.Markdown"
  WriteRegStr HKLM "Software\RegisteredApplications" "QuillMesh" "Software\QuillMesh\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegValue HKLM "Software\RegisteredApplications" "QuillMesh"
  DeleteRegKey HKLM "Software\QuillMesh\Capabilities"
  DeleteRegKey /ifempty HKLM "Software\QuillMesh"
!macroend
