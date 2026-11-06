// Production values for main.bicep (c005 design.md D13). The repository is public: nothing here
// may be secret or personal (docs/conventions/configuration.md § Where each value lives).
using 'main.bicep'

param location = 'germanywestcentral'

// Set by the deploy workflow to the commit SHA it built; there is no default, so a deploy without
// a tag fails before it starts.
param imageTag = readEnvironmentVariable('IMAGE_TAG')
