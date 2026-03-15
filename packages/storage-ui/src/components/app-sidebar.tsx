import { FolderIcon, HardDriveIcon, LogOutIcon, Share2Icon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveRoot } from "@/hooks/use-active-root";
import { useRoots } from "@/hooks/use-folder-cache";
import { useAuth } from "@/lib/auth";

export function AppSidebar() {
  const { user, logout } = useAuth();
  const { roots, isLoading } = useRoots();
  const [, setSearchParams] = useSearchParams();
  const { activeRoot, setActiveRoot } = useActiveRoot();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => {
                if (roots) {
                  setActiveRoot("user");
                  setSearchParams({ folder: roots.userRoot.id });
                  setOpenMobile(false);
                }
              }}
            >
              <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <HardDriveIcon className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Deniz Cloud</span>
                <span className="text-xs text-muted-foreground">Storage</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <>
                  <SidebarMenuItem>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <Skeleton className="size-4 rounded" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <Skeleton className="size-4 rounded" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </SidebarMenuItem>
                </>
              ) : (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeRoot === "user"}
                      onClick={() => {
                        if (roots) {
                          setActiveRoot("user");
                          setSearchParams({ folder: roots.userRoot.id });
                          setOpenMobile(false);
                        }
                      }}
                    >
                      <FolderIcon className="size-4" />
                      <span>My Files</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeRoot === "shared"}
                      onClick={() => {
                        if (roots) {
                          setActiveRoot("shared");
                          setSearchParams({ folder: roots.sharedRoot.id });
                          setOpenMobile(false);
                        }
                      }}
                    >
                      <Share2Icon className="size-4" />
                      <span>Shared</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout}>
              <LogOutIcon className="size-4" />
              <span>Sign out</span>
              <span className="ml-auto text-xs text-muted-foreground">{user?.username}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
